/**
 * Fetches the open/closed/merged PR list for a session's workspace so
 * the chat composer's `#` mention popup can offer them. The `pr` query
 * (single, branch-matched) stays separate — it powers the action bar.
 *
 * Refetches on focus so a freshly-opened PR shows up when the user
 * tabs back to the app, but staleTime keeps idle composer keystrokes
 * from thrashing GitHub.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useWorktreeScope } from '@/hooks/use-execution';
import type { PrListResponse } from '@/app/api/sessions/[id]/prs/route';

export type { PrListItem, PrListResponse } from '@/app/api/sessions/[id]/prs/route';

export function usePrList(sessionId: string | null | undefined) {
  // Scoped to the execution, not the chat: this hits GitHub, and keying it
  // per chat meant every hop between sibling chats fired a fresh request
  // for a list that cannot have changed.
  const scope = useWorktreeScope(sessionId ?? null);
  return useQuery({
    queryKey: [...(scope ?? ['session', sessionId ?? '__none__']), 'prs'],
    queryFn: () => api.get<PrListResponse>(`/sessions/${sessionId}/prs`),
    enabled: !!sessionId && !!scope,
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  });
}
