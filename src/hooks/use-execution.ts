import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
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
  const qc = useQueryClient();
  const queryKey = ['session', id, 'events'] as const;
  return useQuery({
    queryKey,
    queryFn: async () => {
      const fresh = await sessionsApi.events(id!);
      // Merge with any events `useSessionStream` already pushed into
      // the cache before this snapshot resolved. Without this, the
      // mount-time race (stream delivers an event between snapshot
      // SELECT and snapshot arrival) silently drops that event from
      // the cache until the next refetch. Same merge handles
      // focus-refetch overlap.
      const cached = qc.getQueryData<ChatEventRecord[]>(queryKey);
      if (!cached?.length) return fresh;
      const seen = new Set(fresh.map((e) => e.id));
      const extra = cached.filter((e) => !seen.has(e.id));
      if (extra.length === 0) return fresh;
      return [...fresh, ...extra].sort((a, b) => {
        if (a.created_at !== b.created_at) {
          return a.created_at < b.created_at ? -1 : 1;
        }
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
    },
    enabled: !!id,
    // No polling — `useSessionStream` pushes new rows into this same
    // cache as they're written. Snapshot still fires on mount + window
    // focus as a fallback if the stream is unavailable.
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

interface InternalSendInput extends SendMessageInput {
  /** Client-minted row id, shared between optimistic UI and the POST. */
  eventId: string;
}

export function useSendMessage(id: string) {
  const qc = useQueryClient();
  const eventsKey = ['session', id, 'events'] as const;

  const mutation = useMutation<ChatEventRecord, Error, InternalSendInput>({
    mutationFn: (input) =>
      sessionsApi.sendMessage(id, input.content, {
        attachments: input.attachments,
        eventId: input.eventId,
      }),
    onMutate: (input) => {
      // Optimistic insert. The user's message lands in the transcript
      // the instant they hit send, before the round-trip completes.
      // The button stays loading until the POST resolves, so the user
      // knows the network step is in flight — but the message itself
      // is already in the feed.
      //
      // The optimistic row and the persisted row share the same id
      // (`input.eventId`), so React's reconciler keeps the same DOM
      // node when the POST resolves — no unmount/remount flash.
      const placeholder: ChatEventRecord = {
        id: input.eventId,
        session_id: id,
        role: 'user',
        source: 'user',
        content: input.content,
        attachments: input.attachments ?? [],
        created_at: new Date().toISOString(),
        tool_name: null,
        tool_input: null,
        tool_is_error: null,
        tool_exit_code: null,
        external_event_id: null,
        external_message_id: null,
        external_turn_id: null,
        external_tool_call_id: null,
        external_parent_tool_call_id: null,
        source_part_index: 0,
        raw: null,
      };
      qc.setQueryData<ChatEventRecord[]>(eventsKey, (prev) => [...(prev ?? []), placeholder]);
    },
    onSuccess: (realEvent) => {
      // The persisted row carries the same id as the placeholder, so
      // the cache row is already at the right key. Replace in place so
      // any server-defaulted columns the client didn't synthesize are
      // stamped through. SSE delivering the same id is dedup'd by
      // `useSessionStream`.
      qc.setQueryData<ChatEventRecord[]>(eventsKey, (prev) => {
        if (!prev) return prev;
        return prev.map((e) => (e.id === realEvent.id ? realEvent : e));
      });
      qc.invalidateQueries({ queryKey: ['session', id] });
      qc.invalidateQueries({ queryKey: ['workspaces'] });
    },
    onError: (_err, input) => {
      // Send failed — roll back the optimistic so the transcript
      // doesn't carry a phantom message. The composer keeps its
      // content; user can retry.
      qc.setQueryData<ChatEventRecord[]>(eventsKey, (prev) => {
        if (!prev) return prev;
        return prev.filter((e) => e.id !== input.eventId);
      });
    },
  });

  // Public surface: callers pass `SendMessageInput | string` as before;
  // we mint the id here and inject it before handing off to the
  // underlying mutation. Callers never see the optimistic-id detail.
  const normalize = (input: SendMessageInput | string): InternalSendInput => {
    const base: SendMessageInput =
      typeof input === 'string' ? { content: input } : input;
    return { ...base, eventId: uuidv7() };
  };

  return {
    ...mutation,
    mutate: (input: SendMessageInput | string) => mutation.mutate(normalize(input)),
    mutateAsync: (input: SendMessageInput | string) => mutation.mutateAsync(normalize(input)),
  };
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
 * Permission/question requests waiting on the user. The list is pushed
 * via `useSessionStream` whenever the executor's pending-input store
 * mutates — register/resolve/reject all publish to the bus. Snapshot
 * fires on mount + focus as a fallback. Pending state lives in process
 * memory; on server restart this returns [] and the agent's awaiting
 * promise is gone with it.
 */
export function usePendingInput(id: string | null) {
  return useQuery({
    queryKey: ['session', id, 'pending-input'],
    queryFn: () => sessionsApi.pendingInput(id!),
    enabled: !!id,
  });
}

export function useResolvePendingInput(sessionId: string) {
  return useMutation({
    mutationFn: ({ requestId, body }: { requestId: string; body: ResolvePendingBody }) =>
      sessionsApi.resolvePendingInput(sessionId, requestId, body),
    // Both the overlay disappearance (pending_input publish from
    // resolveRequest) and the resulting transcript event (publishChatEvent
    // from the response-write path) come through the SSE stream — no
    // invalidation needed.
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
 * "Is this turn running" flag. Pushed by `useSessionStream` whenever
 * the executor flips `runningSessions` (dispatch start, dispatch end,
 * close). Snapshot fires on mount + focus as a fallback if the stream
 * is unavailable.
 *
 * Survives reloads: if a turn was running when the user closed the tab
 * and they reopen mid-stream, the SSE connect-time `runtime` frame
 * seeds the indicator immediately.
 */
export function useRuntimeStatus(id: string | null) {
  return useQuery({
    queryKey: ['session', id, 'runtime-status'],
    queryFn: () => sessionsApi.runtimeStatus(id!),
    enabled: !!id,
  });
}

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
  return useMutation({
    mutationFn: () => sessionsApi.interrupt(id),
    // Stream pushes both: the aborted `result` event (publishChatEvent
    // from the executor's onEvent) and the runtime flip (publishRuntime
    // when `dispatch`'s finally block runs setRunning(false)).
  });
}
