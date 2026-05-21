/**
 * `gh pr view <number> --json mergeable,mergeStateStatus`
 *
 * `@agentex/github`'s `getPR` doesn't surface the mergeable field, so we
 * shell out separately to keep the action bar's "PR ↔ base conflict"
 * affordance honest. Falls back to `'UNKNOWN'` on any failure — the UI
 * treats unknown as "render the in-sync state" rather than blocking on
 * a side-channel call that's allowed to fail.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** Mirrors GitHub's GraphQL `mergeable` field — what `gh` emits as JSON. */
export type PrMergeable = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';

interface GhMergeableResponse {
  mergeable?: string;
  mergeStateStatus?: string;
}

/**
 * Returns the PR's mergeable state. `'UNKNOWN'` is the safe fallback —
 * either GitHub hasn't computed it yet (race after a recent push) or
 * gh/auth is unavailable. Callers should treat it as "no signal" and
 * fall through to their default state, not as a blocker.
 *
 * `cwd` should be the repo path so gh picks up the right remote without
 * a `-R owner/repo` flag — matches how `@agentex/github`'s repo ops are
 * scoped via `github.repo(cwd)`.
 */
export async function getPrMergeable(cwd: string, prNumber: number): Promise<PrMergeable> {
  try {
    const { stdout } = await exec(
      'gh',
      ['pr', 'view', String(prNumber), '--json', 'mergeable,mergeStateStatus'],
      { cwd, encoding: 'utf8' },
    );
    const parsed = JSON.parse(stdout) as GhMergeableResponse;
    const raw = parsed.mergeable;
    if (raw === 'MERGEABLE' || raw === 'CONFLICTING') return raw;
    return 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}
