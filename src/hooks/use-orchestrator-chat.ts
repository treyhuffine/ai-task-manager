import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { ChatSessionRecord, EffortLevel } from '@/db/types';
import type { HarnessId } from '@/lib/agents/registry';

/** Mirrors `user_state.orchestratorMode` (see schema.ts). */
export type OrchestratorMode = 'legacy' | 'harness_skills' | 'harness_mcp';

export const ORCHESTRATOR_CHAT_KEY = ['orchestrator-chat'] as const;

interface OrchestratorChatResponse {
  session: ChatSessionRecord;
}

/**
 * The active interactive orchestrator chat session (harness modes).
 * GET has ensure semantics — the server creates the session if none
 * exists, so consumers can treat `data.session` as always-present once
 * loaded.
 */
export function useOrchestratorChat(enabled = true) {
  return useQuery({
    queryKey: ORCHESTRATOR_CHAT_KEY,
    queryFn: () => api.get<OrchestratorChatResponse>('/orchestrator-chat'),
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Start a fresh orchestrator chat: archives the current session (tearing
 * down its harness process) and creates a new one. Used by the "New chat"
 * affordance and by mode switches — session flags (MCP attachment, tool
 * guards) are read at process spawn, so a new session is the clean cut.
 */
export function useNewOrchestratorChat() {
  const qc = useQueryClient();
  return useMutation({
    // Optional provider/model = the composer's "switch provider" → fresh
    // orchestrator chat on the chosen provider. No args (void) = plain new chat.
    mutationFn: (opts: {
      providerId?: HarnessId;
      model?: string;
      variant?: string;
      effort?: EffortLevel;
    } | void) =>
      api.post<OrchestratorChatResponse>('/orchestrator-chat', opts ?? {}),
    onSuccess: (data) => {
      qc.setQueryData(ORCHESTRATOR_CHAT_KEY, data);
      qc.invalidateQueries({ queryKey: ORCHESTRATOR_CHAT_HISTORY_KEY });
    },
  });
}

// ─── History ──────────────────────────────────────────────────

export const ORCHESTRATOR_CHAT_HISTORY_KEY = ['orchestrator-chat', 'history'] as const;

export interface OrchestratorChatHistoryEntry {
  id: string;
  /** Retrospective summary, written when the chat is archived. Null while live. */
  label: string | null;
  /** Last user message, truncated — the live/fallback content scent. */
  snippet: string | null;
  status: 'active' | 'archived';
  startedAt: string;
  lastOutcomeEventAt: string | null;
  /** Rail sort key — anything that happened, human or agent. */
  lastActivityAt: string | null;
}

/** Past + current interactive orchestrator chats, newest activity first. */
export function useOrchestratorChatHistory(enabled: boolean) {
  return useQuery({
    queryKey: ORCHESTRATOR_CHAT_HISTORY_KEY,
    queryFn: () =>
      api.get<{ sessions: OrchestratorChatHistoryEntry[] }>('/orchestrator-chat/history'),
    enabled,
  });
}

/**
 * Resume a past chat: it becomes the current session (the previous current
 * one is archived). The harness picks the conversation back up via its
 * persisted external session id on the next send.
 */
export function useResumeOrchestratorChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<OrchestratorChatResponse>('/orchestrator-chat/resume', { sessionId }),
    onSuccess: (data) => {
      qc.setQueryData(ORCHESTRATOR_CHAT_KEY, data);
      qc.invalidateQueries({ queryKey: ORCHESTRATOR_CHAT_HISTORY_KEY });
      // The resumed session's row changed (status flip) — refresh its query
      // so the transcript view picks it up immediately.
      qc.invalidateQueries({ queryKey: ['session', data.session.id] });
    },
  });
}
