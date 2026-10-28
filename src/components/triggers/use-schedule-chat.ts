'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useRuntimeStatus, useSession } from '@/hooks/use-execution';
import { sessionKey as SESSION_KEY } from '@/lib/query/session-keys';
import { apiErrorText } from '@/lib/api/client';
import type { ChatSessionRecord } from '@/lib/api/dto/records';
import { hasRuntimeActivity } from '@/lib/executor/runtime-status';
import { SCHEDULE_CHAT_SURFACE } from '@/lib/triggers/schedule-chat';
import { trpcClient } from '@/lib/trpc/client';
import { rpcQuery } from '@/lib/trpc/request-options';

export function scheduleChatQueryKey(ref: string) {
  return ['document-chat', SCHEDULE_CHAT_SURFACE, ref] as const;
}

async function ensureScheduleChat(ref: string): Promise<ChatSessionRecord> {
  const { session } = await trpcClient.documentChat.list.query({
    query: rpcQuery({ entityType: SCHEDULE_CHAT_SURFACE, entityId: ref }),
  });
  return session;
}

/**
 * A schedule's builder chat: the focused content session beside the schedule
 * form in the Schedules window (src/lib/triggers/builder-brief.ts), keyed by
 * the schedule's id or `NEW_SCHEDULE_REF`.
 *
 * When a turn ends, schedules are refetched so the AI's edits are in the
 * form, and so is the chat itself: the new-schedule chat moves onto the
 * schedule it created (`create_trigger`), and `movedTo` says where, so the
 * window can open that schedule with the conversation still beside it.
 */
export function useScheduleChat(ref: string) {
  const qc = useQueryClient();
  const queryKey = scheduleChatQueryKey(ref);
  const query = useQuery({ queryKey, queryFn: () => ensureScheduleChat(ref), staleTime: 30_000 });
  const session = query.data ?? null;
  const sessionId = session?.id ?? null;
  const runtime = useRuntimeStatus(sessionId);
  const isActive = hasRuntimeActivity(runtime.data);

  const wasActive = useRef(isActive);
  useEffect(() => {
    if (wasActive.current && !isActive) {
      void qc.invalidateQueries({ queryKey: ['triggers'] });
      if (sessionId) void qc.invalidateQueries({ queryKey: SESSION_KEY(sessionId) });
    }
    wasActive.current = isActive;
  }, [isActive, qc, sessionId]);

  // Read from the chat's own record: asking for `ref` again after a move
  // would open a fresh chat.
  const { data: live } = useSession(sessionId);
  const movedTo = live?.surfaceRef && live.surfaceRef !== ref ? live.surfaceRef : null;

  const newChat = useMutation({
    mutationFn: () => trpcClient.documentChat.create.mutate({ body: { entityType: SCHEDULE_CHAT_SURFACE, entityId: ref } }),
    onError: (error) => toast.error('Could not start a new chat', { description: apiErrorText(error) }),
    onSuccess: (data) => qc.setQueryData(queryKey, data.session),
  });

  return { session, sessionId, isActive, movedTo, isLoading: query.isLoading, error: query.error, refetch: query.refetch, newChat };
}

/**
 * Hand a new-schedule chat over to the schedule it created: it is that
 * schedule's chat now, and the next new schedule gets a fresh one.
 */
export function useAdoptMovedScheduleChat() {
  const qc = useQueryClient();
  return (from: string, to: string) => {
    const session = qc.getQueryData<ChatSessionRecord>(scheduleChatQueryKey(from));
    if (session) qc.setQueryData(scheduleChatQueryKey(to), { ...session, surfaceRef: to });
    qc.removeQueries({ queryKey: scheduleChatQueryKey(from), exact: true });
  };
}
