import { apiErrorText } from '@/lib/api/client';
import { trpcClient } from '@/lib/trpc/client';
import type { RouterInputs, RouterOutputs } from '@/lib/trpc/router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * Main chats (docs/agents-view-spec.md §4): the app's main chat (scope
 * `null`, served by `/api/orchestrator-chat`) and each agent's main chat
 * (scope = its workspace id, served by `/api/workspaces/:id/chat`). One
 * current chat per scope. GET has ensure semantics, so `data.session` is
 * always present once loaded.
 */
export type MainChatScope = string | null;

export type MainChatHistoryEntry = RouterOutputs['orchestratorChat']['historyGet']['sessions'][number];

/** Optional provider/model for a fresh chat: the composer's "switch provider". */
export type NewMainChatOptions = NonNullable<RouterInputs['orchestratorChat']['create']['body']>;

export const mainChatKey = (scope: MainChatScope) =>
  scope === null ? (['orchestrator-chat'] as const) : (['agent-chat', scope] as const);

export const mainChatHistoryKey = (scope: MainChatScope) =>
  scope === null ? (['orchestrator-chat', 'history'] as const) : (['agent-chat', scope, 'history'] as const);

/** The scope's current chat, created on first load. */
export function useMainChat(scope: MainChatScope, enabled = true) {
  return useQuery({
    queryKey: mainChatKey(scope),
    queryFn: () => scope === null ? trpcClient.orchestratorChat.list.query({}) : trpcClient.workspaces.chatGet.query({ params: { id: scope } }),
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Start a fresh chat in the scope: the current one is archived (its harness
 * process closed) and a new one created. Used by "New chat", the composer's
 * provider switch, and mode switches.
 */
export function useNewMainChat(scope: MainChatScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: NewMainChatOptions | void) =>
      scope === null ? trpcClient.orchestratorChat.create.mutate({ body: opts ?? {} }) : trpcClient.workspaces.chatNewPost.mutate({ params: { id: scope }, body: opts ?? {} }),
    onError: (error) => toast.error('Could not start a new chat', { description: apiErrorText(error) }),
    onSuccess: (data) => {
      qc.setQueryData(mainChatKey(scope), data);
      qc.invalidateQueries({ queryKey: mainChatHistoryKey(scope) });
    },
  });
}

/** Past and current chats in the scope, newest activity first. */
export function useMainChatHistory(scope: MainChatScope, enabled: boolean) {
  return useQuery({
    queryKey: mainChatHistoryKey(scope),
    queryFn: () => scope === null ? trpcClient.orchestratorChat.historyGet.query({}) : trpcClient.workspaces.chatHistoryGet.query({ params: { id: scope } }),
    enabled,
  });
}

/**
 * Resume a past chat: it becomes the current one (the previous current one
 * is archived). The harness picks the conversation back up on the next send.
 */
export function useResumeMainChat(scope: MainChatScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      scope === null ? trpcClient.orchestratorChat.resumePost.mutate({ body: { sessionId } }) : trpcClient.workspaces.chatResumePost.mutate({ params: { id: scope }, body: { sessionId } }),
    onSuccess: (data) => {
      qc.setQueryData(mainChatKey(scope), data);
      qc.invalidateQueries({ queryKey: mainChatHistoryKey(scope) });
      // The resumed chat's row changed (status flip), so refresh its query
      // and the transcript view picks it up immediately.
      qc.invalidateQueries({ queryKey: ['session', data.session.id] });
    },
  });
}
