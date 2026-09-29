/**
 * GitHub for an execution's branch: its pull request, merging it, and
 * auto-merge (P4.5). `gh` runs in a clone of the repository, so the home
 * runs these in the agent's folder there, and for an agent that lives only
 * on another computer that computer's worker runs them in its folder
 * (`request: github`). Same answers either way, as `{ status, body }`. No
 * database: a worker runs this too.
 */

import { getPrStatus, type PrMergeable, type PrStatus } from './pr-mergeable';
import type { PrChecks, PrReviewDecision } from './pr-status-types';
import { resolveSessionPr } from './session-pr';
import { disableAutoMerge, enableAutoMerge, getAutoMergeEligibility, type MergeMethod } from './auto-merge';

export interface PrInfo {
  number: number;
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  title: string;
  updatedAt: string;
  /**
   * GitHub-reported mergeability. `'UNKNOWN'` either means GitHub hasn't
   * computed it yet (typically right after a push) or our gh side-call
   * failed — the action bar treats unknown as in-sync, not as a blocker.
   * Only populated for OPEN PRs; closed/merged PRs carry `null`.
   */
  mergeable: PrMergeable | null;
  /**
   * Rolled-up CI check state for an OPEN PR. `null` when the PR has no
   * checks, when it's closed/merged, or when the gh side-call failed.
   */
  checks: PrChecks | null;
  /**
   * GitHub's review decision for an OPEN PR (`approved` /
   * `changes_requested` / `review_required`). `null` when there's no
   * decision, when it's closed/merged, or when the gh side-call failed.
   */
  reviewDecision: PrReviewDecision | null;
  /** Whether auto-merge ("merge when ready") is enabled on the PR. */
  autoMergeEnabled: boolean;
}

type PrLike = Pick<PrInfo, 'number' | 'url' | 'state' | 'isDraft' | 'headRefName' | 'baseRefName' | 'title' | 'updatedAt'>;

function toPrInfo(pr: PrLike, status: PrStatus | null): PrInfo {
  return {
    number: pr.number,
    url: pr.url,
    state: pr.state,
    isDraft: pr.isDraft,
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName,
    title: pr.title,
    updatedAt: pr.updatedAt,
    mergeable: status?.mergeable ?? null,
    checks: status?.checks ?? null,
    reviewDecision: status?.reviewDecision ?? null,
    autoMergeEnabled: status?.autoMergeEnabled ?? false,
  };
}

export const MERGE_METHODS: readonly MergeMethod[] = ['squash', 'merge', 'rebase'];

/**
 * gh refusing because the repository has no remote, or none on GitHub
 * ("none of the git remotes configured for this repository point to a
 * known GitHub host"): such a repository simply has no pull requests.
 */
export function notOnGithub(err: unknown): boolean {
  return err instanceof Error && err.name === 'GhCommandError' && /no git remotes|none of the git remotes/i.test(err.message);
}

export type GithubRequest =
  | { op: 'pr'; prNumber: number | null; branchName: string }
  | { op: 'merge'; prNumber: number | null; branchName: string; method?: MergeMethod; deleteBranch?: boolean }
  | { op: 'auto_merge'; prNumber: number | null; branchName: string; enable: boolean; method?: MergeMethod };

export interface GithubAnswer {
  status: number;
  body: unknown;
}

export async function runGithub(cwd: string, request: GithubRequest): Promise<GithubAnswer> {
  const { github, NotInstalledError, NotAuthenticatedError, RepoNotFoundError, GhCommandError } = await import('@agentex/github');
  const repo = github.repo(cwd);
  const session = { prNumber: request.prNumber, branchName: request.branchName };
  try {
    switch (request.op) {
      case 'pr': {
        // The linked PR wins, then the branch (exact, then fork-style suffix), open first.
        if (request.prNumber != null) {
          try {
            const pr = await repo.getPR(request.prNumber);
            const status = pr.state === 'OPEN' ? await getPrStatus(cwd, pr.number) : null;
            return { status: 200, body: { pr: toPrInfo(pr, status) } };
          } catch {
            // Deleted on GitHub: fall through to the branch.
          }
        }
        const all = await repo.listPRs({ state: 'all' });
        let matching = all.filter((p) => p.headRefName === request.branchName);
        if (matching.length === 0) matching = all.filter((p) => p.headRefName.endsWith(request.branchName));
        const pr = matching.find((p) => p.state === 'OPEN') ?? matching[0];
        if (!pr) return { status: 200, body: { pr: null } };
        const status = pr.state === 'OPEN' ? await getPrStatus(cwd, pr.number) : null;
        return { status: 200, body: { pr: toPrInfo(pr, status) } };
      }
      case 'merge': {
        const pr = await resolveSessionPr(repo, session);
        if (!pr || pr.state !== 'OPEN') return { status: 404, body: { error: 'no_open_pr', message: 'No open PR for this session.' } };
        try {
          await repo.merge(pr.number, { method: request.method ?? 'squash', deleteBranch: request.deleteBranch ?? true });
          return { status: 200, body: { ok: true, prNumber: pr.number, url: pr.url } };
        } catch (err) {
          if (err instanceof GhCommandError) return { status: 409, body: { error: 'merge_failed', message: err.message } };
          throw err;
        }
      }
      case 'auto_merge': {
        const pr = await resolveSessionPr(repo, session);
        if (!pr || pr.state !== 'OPEN') return { status: 404, body: { error: 'no_open_pr', message: 'No open PR for this session.' } };
        try {
          if (request.enable) {
            const elig = await getAutoMergeEligibility(cwd, pr.number).catch(() => null);
            if (elig && !elig.canEnable && !elig.enabled) {
              return { status: 409, body: { error: 'auto_merge_unavailable', message: elig.reason ?? 'Auto-merge cannot be enabled.' } };
            }
            const method: MergeMethod = request.method ?? (elig?.allowedMethods.includes('squash') ? 'squash' : elig?.allowedMethods[0] ?? 'squash');
            await enableAutoMerge(cwd, pr.number, method);
            return { status: 200, body: { ok: true, enabled: true, prNumber: pr.number, url: pr.url } };
          }
          await disableAutoMerge(cwd, pr.number);
          return { status: 200, body: { ok: true, enabled: false, prNumber: pr.number, url: pr.url } };
        } catch (err) {
          if (err instanceof NotInstalledError || err instanceof NotAuthenticatedError) throw err;
          return { status: 409, body: { error: 'auto_merge_failed', message: err instanceof Error ? err.message : String(err) } };
        }
      }
    }
  } catch (err) {
    if (err instanceof NotInstalledError) return request.op === 'pr' ? { status: 200, body: { pr: null, ghStatus: 'not_installed' } } : { status: 412, body: { error: err.message } };
    if (err instanceof NotAuthenticatedError) return request.op === 'pr' ? { status: 200, body: { pr: null, ghStatus: 'not_authenticated' } } : { status: 412, body: { error: err.message } };
    // A local-only repo, or one whose remote isn't on GitHub, has no PR.
    if (request.op === 'pr' && (notOnGithub(err) || err instanceof RepoNotFoundError)) return { status: 200, body: { pr: null } };
    if (notOnGithub(err)) return { status: 409, body: { error: 'not_on_github', message: "This repository isn't on GitHub, so it has no pull request." } };
    throw err;
  }
}
