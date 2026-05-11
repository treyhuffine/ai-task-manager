import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionsApi, type ResolvePendingBody, type WipApplyResult } from '@/lib/api/sessions';
import type { PermissionMode, EffortLevel, ChatEventRecord, Attachment } from '@/db/types';
import { resolveModelInfo, type ModelInfo } from '@/lib/executor/context-window';

const SESSION_KEY = (id: string) => ['session', id] as const;

export function useSession(id: string | null) {
  return useQuery({
    queryKey: ['session', id],
    queryFn: () => sessionsApi.get(id!),
    enabled: !!id,
  });
}

export function useSessionEvents(id: string | null) {
  return useQuery({
    queryKey: ['session', id, 'events'],
    queryFn: () => sessionsApi.events(id!),
    enabled: !!id,
    refetchInterval: 3_000,        // poll-based until executor pipe lands
  });
}

export function useSessionStatus(id: string | null) {
  return useQuery({
    queryKey: ['session', id, 'status'],
    queryFn: () => sessionsApi.status(id!),
    enabled: !!id,
    staleTime: 2_000,
  });
}

export function useSessionDiff(id: string | null, file?: string) {
  return useQuery({
    queryKey: ['session', id, 'diff', file ?? null],
    queryFn: () => sessionsApi.diff(id!, file),
    enabled: !!id,
    staleTime: 2_000,
  });
}

/**
 * Invalidate every read cache that depends on the worktree's filesystem
 * state — diff, status, files, shortstat — so the UI repaints after a
 * mutation that changes git state (commit, push, pull, etc.).
 */
function invalidateWorktree(qc: ReturnType<typeof useQueryClient>, id: string) {
  qc.invalidateQueries({ queryKey: SESSION_KEY(id) });
  qc.invalidateQueries({ queryKey: ['workspaces'] });
}

export function useCommit(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => sessionsApi.commit(id, message),
    onSuccess: () => invalidateWorktree(qc, id),
  });
}

export function usePush(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sessionsApi.push(id),
    onSuccess: () => invalidateWorktree(qc, id),
  });
}

export function usePullBase(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (strategy?: 'merge' | 'rebase') => sessionsApi.pullBase(id, strategy ?? 'merge'),
    onSuccess: () => invalidateWorktree(qc, id),
  });
}

export interface SendMessageInput {
  content: string;
  attachments?: Attachment[];
}

export function useSendMessage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SendMessageInput | string) => {
      const normalized: SendMessageInput =
        typeof input === 'string' ? { content: input } : input;
      return sessionsApi.sendMessage(id, normalized.content, {
        attachments: normalized.attachments,
      });
    },
    onSuccess: () => {
      // Repaint the transcript immediately rather than waiting for the
      // 3s poll, bump runtime-status so the working indicator turns on
      // without waiting for its own poll, and re-fetch the session row
      // since the first message derives the label server-side.
      qc.invalidateQueries({ queryKey: ['session', id, 'events'] });
      qc.invalidateQueries({ queryKey: ['session', id, 'runtime-status'] });
      qc.invalidateQueries({ queryKey: ['session', id] });
      qc.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}

export function useUpdateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: {
      id: string;
      label?: string | null;
      permission_mode?: PermissionMode;
      model?: string | null;
      effort?: EffortLevel | null;
    }) => sessionsApi.update(id, input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['session', data.id] });
      qc.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}

/**
 * Permission/question requests waiting on the user. Polls every 1.5s
 * while the agent is mid-turn so the floating overlay surfaces quickly
 * after Claude calls a tool that needs approval. Pending state lives in
 * the executor's process memory; on server restart this returns [] and
 * the agent's awaiting promise is gone with it.
 */
export function usePendingInput(id: string | null) {
  return useQuery({
    queryKey: ['session', id, 'pending-input'],
    queryFn: () => sessionsApi.pendingInput(id!),
    enabled: !!id,
    refetchInterval: 1_500,
    staleTime: 500,
  });
}

export function useResolvePendingInput(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, body }: { requestId: string; body: ResolvePendingBody }) =>
      sessionsApi.resolvePendingInput(sessionId, requestId, body),
    onSuccess: () => {
      // Drop the entry immediately rather than waiting for the next
      // poll — user gets the visual confirmation that their answer
      // was accepted. The transcript event will land on the next
      // events poll (3s) but the overlay is already gone.
      qc.invalidateQueries({ queryKey: ['session', sessionId, 'pending-input'] });
      qc.invalidateQueries({ queryKey: ['session', sessionId, 'events'] });
    },
  });
}

export interface SessionMeta {
  model: ModelInfo | null;
  /** Tokens consumed by the most recent turn's input message. */
  lastInputTokens: number | null;
  /** Tokens consumed by the most recent turn's output. */
  lastOutputTokens: number | null;
  /** lastInputTokens / model.contextWindow as a 0..1 fraction. */
  contextUsedFraction: number | null;
}

/**
 * Derive composer-display metadata from chat_events. Reads the most
 * recent `system` event for the model id and the most recent `result`
 * event for token usage. Model id comes from agentex's StreamEvent
 * (`event.model`); usage comes from `event.usage` on the result.
 *
 * Fraction is computed off `input_tokens` because that's "how full is
 * the context window right now" (output tokens are billed but don't
 * count against context). When the model id resolves to a registered
 * cap (Opus 4.7 = 1M, Sonnet 4.6 = 1M, etc.), we surface the percentage;
 * unknown models hide it.
 */
export function useSessionMeta(sessionId: string | null): SessionMeta {
  const { data: events } = useSessionEvents(sessionId);
  return useMemo(() => deriveSessionMeta(events ?? []), [events]);
}

function deriveSessionMeta(events: ChatEventRecord[]): SessionMeta {
  let modelId: string | null = null;
  let lastInputTokens: number | null = null;
  let lastOutputTokens: number | null = null;

  // Walk newest-first; first hits win. Result events carry usage.
  // System events carry the active model id.
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    const raw = (ev.raw ?? {}) as Record<string, unknown>;
    if (lastInputTokens == null && ev.source === 'result') {
      const usage = raw['usage'] as
        | Record<string, { input_tokens?: number; output_tokens?: number } | number | undefined>
        | undefined;
      if (usage) {
        // Claude shape: usage.{ model_id }.input_tokens. Codex shape:
        // usage.input_tokens directly. Try both.
        let input = 0;
        let output = 0;
        for (const v of Object.values(usage)) {
          if (typeof v === 'object' && v) {
            input += v.input_tokens ?? 0;
            output += v.output_tokens ?? 0;
          }
        }
        if (input === 0 && typeof (usage as { input_tokens?: number }).input_tokens === 'number') {
          input = (usage as { input_tokens: number }).input_tokens;
          output = (usage as { output_tokens?: number }).output_tokens ?? 0;
        }
        if (input > 0) {
          lastInputTokens = input;
          lastOutputTokens = output;
        }
      }
    }
    if (modelId == null && ev.source === 'system') {
      const m = raw['model'];
      if (typeof m === 'string' && m) modelId = m;
    }
    if (lastInputTokens != null && modelId != null) break;
  }

  const model = resolveModelInfo(modelId);
  const contextUsedFraction =
    model && model.contextWindow > 0 && lastInputTokens != null
      ? Math.min(1, lastInputTokens / model.contextWindow)
      : null;

  return { model, lastInputTokens, lastOutputTokens, contextUsedFraction };
}

/**
 * Polls /api/sessions/:id/runtime-status to drive "is this turn running"
 * UI state. The 2-second interval is responsive without hammering the
 * server (it's a single Set lookup; even at 2s/poll a hundred open
 * tabs is fine).
 *
 * Survives reloads: if a turn was running when the user closed the tab
 * and they reopen mid-stream, the indicator picks up immediately.
 */
export function useRuntimeStatus(id: string | null) {
  return useQuery({
    queryKey: ['session', id, 'runtime-status'],
    queryFn: () => sessionsApi.runtimeStatus(id!),
    enabled: !!id,
    refetchInterval: 2_000,
    staleTime: 1_000,
  });
}

/**
 * Cancels the running agent turn. After the interrupt resolves we kick
 * the runtime-status + events queries so the composer flips back from
 * "stop" to "send" and any final aborted-result event surfaces without
 * waiting for the 2s/3s polls.
 */
/**
 * Live WIP read against the source repo of a session's workspace. Fires
 * once when `enabled` flips true (after the worktree is provisioned and
 * the banner mounts). No interval — WIP is a snapshot for the prompt;
 * if the user dismisses the banner and reopens the session, a re-fetch
 * surfaces whatever's there now.
 */
export function useSessionWip(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['session', id, 'wip'],
    queryFn: () => sessionsApi.wip(id!),
    enabled: !!id && enabled,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useApplyWip(id: string) {
  const qc = useQueryClient();
  return useMutation<WipApplyResult, Error, 'copy' | 'move'>({
    mutationFn: (action) => sessionsApi.applyWip(id, action),
    onSuccess: () => {
      // The worktree's working tree just changed — repaint diff/status.
      qc.invalidateQueries({ queryKey: ['session', id] });
    },
  });
}

export function useInterruptSession(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sessionsApi.interrupt(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['session', id, 'runtime-status'] });
      qc.invalidateQueries({ queryKey: ['session', id, 'events'] });
    },
  });
}
