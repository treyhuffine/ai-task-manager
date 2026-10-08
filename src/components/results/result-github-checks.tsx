'use client';

import { ExternalLink, GitPullRequest, Loader2 } from 'lucide-react';
import { useSessionPr } from '@/hooks/use-execution-actions';
import type { WorkResultRecord } from '@/db/types';
import { resultLinkUrl } from './presentation';

/** Live provider observations remain separate from the immutable agent answer. */
export function ResultGithubChecks({ result }: { result: WorkResultRecord }) {
  const query = useSessionPr(result.sourceChatSessionId);
  const pr = query.data?.pr;
  // Non-code work without a producing conversation has no relevant PR context.
  if (!result.codeRevision && !pr && !query.error) return null;

  const revision = result.codeRevision;
  const headSha = pr?.headSha ?? null;
  let limitation: string | null = null;
  if (!result.sourceChatSessionId) limitation = 'The authoring conversation is unavailable.';
  else if (query.error || (query.data && 'ghStatus' in query.data && query.data.ghStatus)) limitation = 'Live GitHub check status is unavailable.';
  else if (!pr) limitation = query.isLoading ? 'Loading live GitHub checks.'
    : query.data ? 'No linked pull request is available.' : 'Live GitHub check status has not been observed.';
  else if (!headSha) limitation = 'GitHub did not report the pull request head revision.';
  else if (!revision?.commitSha || revision.workingTreeState !== 'clean') limitation = 'The saved handoff has no known clean commit binding.';
  else if (headSha.toLowerCase() !== revision.commitSha.toLowerCase()) limitation = 'The pull request now points to a different commit.';
  const bound = !limitation;
  const checks = bound ? pr?.checks : null;
  const prUrl = pr ? resultLinkUrl(pr.url) : null;

  return <section aria-label="Live GitHub checks" className="space-y-2 rounded-lg border p-3 text-xs">
    <p className="flex items-center gap-1.5 font-medium"><GitPullRequest size={13} />GitHub checks (live){query.isFetching && <Loader2 size={12} className="animate-spin" />}</p>
    {bound ? <>
      <p className="break-all text-muted-foreground">Checks for saved commit <code>{headSha}</code>.</p>
      {checks ? <p>GitHub reports {checks.state === 'passing' ? 'passing' : checks.state === 'failing' ? 'failing' : 'pending'} checks: {checks.passed} passed, {checks.failed} failed, {checks.pending} pending.</p>
        : <p className="text-muted-foreground">No GitHub checks reported for this commit.</p>}
    </> : <>
      <p className="text-muted-foreground">Unknown for this handoff. {limitation}</p>
      {revision?.commitSha && <p className="break-all text-muted-foreground">Saved commit: <code>{revision.commitSha}</code> ({revision.workingTreeState}).</p>}
      {headSha && <p className="break-all text-muted-foreground">Live GitHub head: <code>{headSha}</code>.</p>}
    </>}
    {!!query.dataUpdatedAt && !query.error && <p className="text-[11px] text-muted-foreground">Last observed <time dateTime={new Date(query.dataUpdatedAt).toISOString()}>{new Date(query.dataUpdatedAt).toLocaleString()}</time>. This live status can change.</p>}
    {prUrl && <a href={`${prUrl}/checks`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><ExternalLink size={12} />Open live PR checks</a>}
  </section>;
}
