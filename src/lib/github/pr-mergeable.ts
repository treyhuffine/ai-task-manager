/**
 * `gh pr view <number> --json mergeable,mergeStateStatus,reviewDecision,statusCheckRollup`
 *
 * `@agentex/github`'s `getPR` surfaces `statusCheckRollup`/`reviews` but not
 * `mergeable` or the rolled-up `reviewDecision`, and its `statusCheckRollup`
 * type only models the CheckRun shape (gh also emits legacy StatusContext
 * entries). So we make one `gh` side-call that returns everything the action
 * bar needs about an open PR: mergeability, a CI rollup, and the review
 * decision. Everything falls back to a safe "no signal" value on any failure
 * — the UI treats unknowns as non-blocking rather than gating on a
 * side-channel call that's allowed to fail.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PrChecks, PrCiState, PrReviewDecision } from './pr-status-types';

const exec = promisify(execFile);

/** Mirrors GitHub's GraphQL `mergeable` field — what `gh` emits as JSON. */
export type PrMergeable = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';

export interface PrStatus {
  mergeable: PrMergeable;
  /** `null` when the PR has no checks configured at all. */
  checks: PrChecks | null;
  /** `null` when GitHub reports no review decision (e.g. no required reviews). */
  reviewDecision: PrReviewDecision | null;
  /** Whether "merge when ready" (auto-merge) is currently enabled on the PR. */
  autoMergeEnabled: boolean;
}

/**
 * A `statusCheckRollup` entry. gh returns a heterogeneous array: modern
 * `CheckRun`s carry `status` + `conclusion`; legacy `StatusContext`s carry a
 * single `state`. We read both shapes defensively.
 */
interface RawRollupItem {
  status?: string;
  conclusion?: string;
  state?: string;
}

interface GhPrStatusResponse {
  mergeable?: string;
  mergeStateStatus?: string;
  reviewDecision?: string;
  statusCheckRollup?: RawRollupItem[];
  autoMergeRequest?: unknown;
}

const UNKNOWN_STATUS: PrStatus = {
  mergeable: 'UNKNOWN',
  checks: null,
  reviewDecision: null,
  autoMergeEnabled: false,
};

function classifyRollupItem(c: RawRollupItem): 'passed' | 'failed' | 'pending' {
  // StatusContext: a single `state` enum. `EXPECTED` means a required status
  // is expected but not yet reported — that's pending, not a pass (GitHub
  // documents it separately from SUCCESS), so a missing required check can't
  // masquerade as green.
  if (typeof c.state === 'string' && c.state.length > 0) {
    const s = c.state.toUpperCase();
    if (s === 'SUCCESS') return 'passed';
    if (s === 'FAILURE' || s === 'ERROR') return 'failed';
    return 'pending';
  }
  // CheckRun: not done until status === COMPLETED.
  const status = (c.status ?? '').toUpperCase();
  if (status !== 'COMPLETED') return 'pending';
  const conclusion = (c.conclusion ?? '').toUpperCase();
  if (conclusion === 'SUCCESS' || conclusion === 'NEUTRAL' || conclusion === 'SKIPPED') return 'passed';
  if (
    conclusion === 'FAILURE' ||
    conclusion === 'TIMED_OUT' ||
    conclusion === 'CANCELLED' ||
    conclusion === 'ACTION_REQUIRED' ||
    conclusion === 'STARTUP_FAILURE' ||
    conclusion === 'STALE'
  ) {
    return 'failed';
  }
  return 'pending';
}

function summarizeChecks(items: RawRollupItem[] | undefined): PrChecks | null {
  if (!items || items.length === 0) return null;
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const c of items) {
    const r = classifyRollupItem(c);
    if (r === 'passed') passed += 1;
    else if (r === 'failed') failed += 1;
    else pending += 1;
  }
  const total = passed + failed + pending;
  if (total === 0) return null;
  // Failing trumps pending trumps passing — the most actionable state wins.
  const state: PrCiState = failed > 0 ? 'failing' : pending > 0 ? 'pending' : 'passing';
  return { state, total, passed, failed, pending };
}

function mapReviewDecision(raw: string | undefined): PrReviewDecision | null {
  switch ((raw ?? '').toUpperCase()) {
    case 'APPROVED':
      return 'approved';
    case 'CHANGES_REQUESTED':
      return 'changes_requested';
    case 'REVIEW_REQUIRED':
      return 'review_required';
    default:
      return null;
  }
}

/**
 * Mergeability + CI rollup + review decision for an open PR. Every field
 * degrades to a safe "no signal" value on failure (`mergeable: 'UNKNOWN'`,
 * `checks: null`, `reviewDecision: null`); callers must not treat those as
 * blockers.
 *
 * `cwd` should be the repo path so gh picks up the right remote without a
 * `-R owner/repo` flag — matches how `@agentex/github`'s repo ops are scoped.
 */
export async function getPrStatus(cwd: string, prNumber: number): Promise<PrStatus> {
  try {
    const { stdout } = await exec(
      'gh',
      [
        'pr',
        'view',
        String(prNumber),
        '--json',
        'mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,autoMergeRequest',
      ],
      { cwd, encoding: 'utf8' },
    );
    const parsed = JSON.parse(stdout) as GhPrStatusResponse;
    const rawMergeable = parsed.mergeable;
    const mergeable: PrMergeable =
      rawMergeable === 'MERGEABLE' || rawMergeable === 'CONFLICTING' ? rawMergeable : 'UNKNOWN';
    return {
      mergeable,
      checks: summarizeChecks(parsed.statusCheckRollup),
      reviewDecision: mapReviewDecision(parsed.reviewDecision),
      autoMergeEnabled: parsed.autoMergeRequest != null,
    };
  } catch {
    return UNKNOWN_STATUS;
  }
}
