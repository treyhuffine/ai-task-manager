import type { PRSummary, RepoOps } from '@agentex/github';

/**
 * Resolve the PR for a session the same way the action bar's PR view does
 * (`GET /api/sessions/:id/pr`): an explicit linked `prNumber` wins — that's
 * what covers manually-linked PRs and fork refs whose head name doesn't
 * match the local branch — then fall back to matching PRs by branch (exact,
 * then a suffix match for `owner:branch` fork refs), preferring an open one.
 *
 * Mutating callers (merge, auto-merge) must resolve through this rather than
 * a bare branch match, or the toggle can hit the wrong PR (or none) for
 * linked/fork/renamed/duplicate-branch sessions. Those callers should also
 * check `state === 'OPEN'` before acting.
 */
export async function resolveSessionPr(
  repo: RepoOps,
  session: { branchName: string | null; prNumber: number | null },
): Promise<PRSummary | null> {
  if (session.prNumber != null) {
    try {
      return await repo.getPR(session.prNumber);
    } catch {
      // Linked PR may have been deleted on GitHub — fall back to branch match.
    }
  }
  const branch = session.branchName;
  if (!branch) return null;
  const all = await repo.listPRs({ state: 'all' });
  let matching = all.filter((p) => p.headRefName === branch);
  if (matching.length === 0) {
    matching = all.filter((p) => p.headRefName.endsWith(branch));
  }
  return matching.find((p) => p.state === 'OPEN') ?? matching[0] ?? null;
}
