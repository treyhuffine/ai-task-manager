import { trpcClient } from '@/lib/trpc/client';
/**
 * Fetches a chat's repository issues, open and closed, so the composer's
 * `@#` menu can list them with the pull requests (`usePrList`).
 *
 * Refetches on focus so an issue filed in another tab shows up when the
 * person comes back, and staleTime keeps idle composer keystrokes from
 * thrashing GitHub.
 */

import { useWorktreeScope } from '@/hooks/use-execution';
import { useQuery } from '@tanstack/react-query';

export type { IssueListItem, IssueListResponse } from '@/lib/server/operations/sessions/[id]/issues';

export function useIssueList(sessionId: string | null | undefined) {
  // Scoped to the execution like the PR list: sibling chats share a
  // repository, so hopping between them shouldn't ask GitHub again.
  const scope = useWorktreeScope(sessionId ?? null);
  return useQuery({
    queryKey: [...(scope ?? ['session', sessionId ?? '__none__']), 'issues'],
    queryFn: () => trpcClient.sessions.issuesGet.query({ params: { id: sessionId ?? '' } }),
    enabled: !!sessionId && !!scope,
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });
}
