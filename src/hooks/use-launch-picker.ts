import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SearchMentionEntities } from '@/components/chat/editor/mention-menu/types';
import { trpc } from '@/lib/trpc/client';

/** Search on demand and cache repeated searches, without creating a placeholder chat. */
export function useLaunchPicker(workspaceId: string | null): SearchMentionEntities {
  const queryClient = useQueryClient();
  return useCallback<SearchMentionEntities>(async search => {
    const data = await queryClient.fetchQuery(trpc.workspaces.launchPicker.queryOptions({ query: {
      workspaceId: workspaceId ?? undefined, q: search.q.trim(), kind: search.kind, limit: String(search.limit),
    } }, { staleTime: 15_000 }));
    return {
      tasks: data.tasks.map(t => ({ kind: 'task', ...t })),
      notes: data.notes.map(n => ({ kind: 'note', ...n })),
      totals: data.totals,
    };
  }, [queryClient, workspaceId]);
}
