import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { ChatSessionRecord, EffortLevel } from '@/db/types';
import type { HarnessId } from '@/lib/harness/registry';

/**
 * Main chats (docs/agents-view-spec.md §4): the app's main chat (scope
 * `null`, served by `/api/orchestrator-chat`) and each agent's main chat
 * (scope = its workspace id, served by `/api/workspaces/:id/chat`). One
 * current chat per scope. GET has ensure semantics, so `data.session` is
 * always present once loaded.
 */
export type MainChatScope = string | null;

interface MainChatResponse {
  session: ChatSessionRecord;
}

export interface MainChatHistoryEntry {
  id: string;
  /** Retrospective summary, written when the chat is archived. Null while live. */
  label: string | null;
  /** Last user message, truncated: the live fallback until the summary lands. */
  snippet: string | null;
  status: 'active' | 'archived';
  startedAt: string;
  lastOutcomeEventAt: string | null;
  /** Rail sort key: anything that happened, human or agent. */
  lastActivityAt: string | null;
}

/** Optional provider/model for a fresh chat: the composer's "switch provider". */
export interface NewMainChatOptions {
  providerId?: HarnessId;
  model?: string;
  variant?: string;
  effort?: EffortLevel;
}

export const mainChatKey = (scope: MainChatScope) =>
  scope === null ? (['orchestrator-chat'] as const) : (['agent-chat', scope] as const);

export const mainChatHistoryKey = (scope: MainChatScope) =>
  scope === null ? (['orchestrator-chat', 'history'] as const) : (['agent-chat', scope, 'history'] as const);

const basePath = (scope: MainChatScope) => (scope === null ? '/orchestrator-chat' : `/workspaces/${scope}/chat`);

/** The scope's current chat, created on first load. */
export function useMainChat(scope: MainChatScope, enabled = true) {
  return useQuery({
    queryKey: mainChatKey(scope),
    queryFn: () => api.get<MainChatResponse>(basePath(scope)),
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
      api.post<MainChatResponse>(scope === null ? basePath(scope) : `${basePath(scope)}/new`, opts ?? {}),
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
    queryFn: () => api.get<{ sessions: MainChatHistoryEntry[] }>(`${basePath(scope)}/history`),
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
      api.post<MainChatResponse>(`${basePath(scope)}/resume`, { sessionId }),
    onSuccess: (data) => {
      qc.setQueryData(mainChatKey(scope), data);
      qc.invalidateQueries({ queryKey: mainChatHistoryKey(scope) });
      // The resumed chat's row changed (status flip), so refresh its query
      // and the transcript view picks it up immediately.
      qc.invalidateQueries({ queryKey: ['session', data.session.id] });
    },
  });
}
