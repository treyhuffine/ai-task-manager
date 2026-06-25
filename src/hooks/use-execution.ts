import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { uuidv7 } from 'uuidv7';
import {
  sessionsApi,
  type FileResponse,
  type ResolvePendingBody,
  type WipApplyResult,
} from '@/lib/api/sessions';
import type { PermissionMode, EffortLevel, ChatEventRecord, Attachment } from '@/db/types';
import { resolveModelInfo, type ModelInfo } from '@/lib/executor/context-window';
import { CHAT_PAGE_SIZE } from '@/constants/chat';

const SESSION_KEY = (id: string) => ['session', id] as const;

/**
 * Canonical transcript ordering: `(createdAt ASC, id ASC)` — the same
 * order `listChatEvents` returns and `useSessionStream` inserts under.
 * Shared by the snapshot merge and the scroll-up prepend so every writer
 * keeps the cached list sorted identically.
 */
function byCreatedThenId(a: ChatEventRecord, b: ChatEventRecord): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

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
      // Snapshot fetches only the most-recent page; older history is
      // paged in lazily by `useLoadOlderEvents` as the user scrolls up.
      const fresh = await sessionsApi.events(id!, { limit: CHAT_PAGE_SIZE });
      // Merge with anything already in the cache the fresh tail doesn't
      // contain: (a) events `useSessionStream` pushed before this
      // snapshot resolved — the mount-time race that would otherwise
      // drop a row until the next refetch; (b) older pages a previous
      // scroll-up already loaded — re-fetching the tail must not discard
      // them. Same merge also covers focus-refetch overlap.
      const cached = qc.getQueryData<ChatEventRecord[]>(queryKey);
      if (!cached?.length) return fresh;
      const seen = new Set(fresh.map((e) => e.id));
      const extra = cached.filter((e) => !seen.has(e.id));
      if (extra.length === 0) return fresh;
      return [...fresh, ...extra].sort(byCreatedThenId);
    },
    enabled: !!id,
    // No polling — `useSessionStream` pushes new rows into this same
    // cache as they're written. Snapshot still fires on mount + window
    // focus as a fallback if the stream is unavailable.
  });
}

/** Sentinel tracking whether the start of history has been reached. */
interface ChatPaginationMeta {
  exhausted: boolean;
}

/**
 * Backward (scroll-up) pagination for the transcript. Pages older
 * `chat_events` into the SAME `['session', id, 'events']` cache that
 * `useSessionEvents` / `useSessionStream` / optimistic sends write to —
 * the transcript stays a single flat, sorted list, so no consumer needs
 * to know paging exists.
 *
 * `hasOlder` gates the scroll-up trigger: false once we've paged to the
 * start (`exhausted`) or whenever the whole history already fits in the
 * first page (raw count < one page → nothing older can exist). Counts
 * the RAW events (not the filtered/rendered subset) because filtering
 * drops result/init rows and would undercount against the page size.
 *
 * Returns the number of rows actually prepended so the caller can anchor
 * scroll position (and skip the no-op when a page came back empty). The
 * pagination meta query is co-observed with the events query by the same
 * component, so the two GC in tandem — `exhausted` can't go stale across
 * a remount.
 */
export function useLoadOlderEvents(
  sessionId: string | null,
  rawEvents: ChatEventRecord[] | undefined,
) {
  const qc = useQueryClient();
  const eventsKey = useMemo(() => ['session', sessionId, 'events'] as const, [sessionId]);
  const metaKey = useMemo(() => ['session', sessionId, 'events-pagination'] as const, [sessionId]);

  const { data: meta } = useQuery({
    queryKey: metaKey,
    queryFn: () =>
      qc.getQueryData<ChatPaginationMeta>(metaKey) ?? { exhausted: false },
    enabled: !!sessionId,
    initialData: () =>
      qc.getQueryData<ChatPaginationMeta>(metaKey) ?? { exhausted: false },
    // Only mutated via `setQueryData` below — never auto-refetched.
    staleTime: Infinity,
  });

  const mutation = useMutation<number, Error, void>({
    mutationFn: async () => {
      if (!sessionId) return 0;
      // Read the live cache (not `rawEvents`) so the cursor is the true
      // current oldest even if a concurrent SSE/optimistic write landed.
      const list = qc.getQueryData<ChatEventRecord[]>(eventsKey) ?? [];
      const oldest = list[0];
      if (!oldest) return 0;
      const older = await sessionsApi.events(sessionId, {
        before: oldest.id,
        limit: CHAT_PAGE_SIZE,
      });
      // A short page means we've hit the start of history.
      qc.setQueryData<ChatPaginationMeta>(metaKey, {
        exhausted: older.length < CHAT_PAGE_SIZE,
      });
      if (older.length === 0) return 0;
      let added = 0;
      qc.setQueryData<ChatEventRecord[]>(eventsKey, (prev) => {
        const cur = prev ?? [];
        const seen = new Set(cur.map((e) => e.id));
        const incoming = older.filter((e) => !seen.has(e.id));
        added = incoming.length;
        if (incoming.length === 0) return cur;
        return [...incoming, ...cur].sort(byCreatedThenId);
      });
      return added;
    },
  });

  const rawCount = rawEvents?.length ?? 0;
  const hasOlder = !(meta?.exhausted ?? false) && rawCount >= CHAT_PAGE_SIZE;

  const loadOlder = mutation.mutateAsync;

  return { loadOlder, isLoadingOlder: mutation.isPending, hasOlder };
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
 * The file tree shown in the execution view's tree column. Tier-2 of the
 * refresh strategy: a slow 30s poll catches edits the user made outside
 * the agent (e.g. via VS Code), and the cache is invalidated by the
 * `useSessionStream` consumer for mutating tool calls (Tier 1). Also
 * invalidated on running→idle by `ExecutionView`.
 */
export function useSessionTree(id: string | null) {
  return useQuery({
    queryKey: ['session', id, 'tree'],
    queryFn: () => sessionsApi.tree(id!),
    enabled: !!id,
    refetchInterval: 30_000,
    staleTime: 5_000,
  });
}

/**
 * Single-file read for the file viewer. No polling — the file viewer is
 * a snapshot. The tree query's invalidation (mutating tool_use + 30s
 * poll + running→idle) is what triggers re-reads of any selected file
 * the user is currently looking at; this hook just caches per-path.
 */
export function useSessionFile(id: string | null, path: string | null) {
  return useQuery({
    queryKey: ['session', id, 'file', path],
    queryFn: () => sessionsApi.file(id!, path!),
    enabled: !!id && !!path,
    staleTime: 30_000,
  });
}

/**
 * Base-branch version of a file for the diff view's "old" side. Same
 * cache key shape as `useSessionFile` but with a `base` discriminator.
 */
export function useSessionBaseFile(id: string | null, path: string | null) {
  return useQuery({
    queryKey: ['session', id, 'file', path, 'base'],
    queryFn: () => sessionsApi.file(id!, path!, { base: true }),
    enabled: !!id && !!path,
    staleTime: 60_000,
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

/**
 * Worktree-file mutations driving the file viewer + tree UI.
 *
 * Each hook invalidates the same caches `invalidateWorktree` covers so
 * a Save/Create/Delete/Rename ripples through diff badges, the action
 * bar's shortstat, and any sibling viewer that happens to be reading
 * the touched file. The `tree` cache is the visible signal — the user
 * sees rows appear/disappear right after the mutation resolves.
 *
 * Optimistic updates would feel snappier, but the tree carries M/A/D
 * status flags + mtime that we'd have to synthesize correctly to match
 * `git status`. Round-tripping through the server is the simpler
 * correctness story; the request is local so latency is ~10ms.
 */
/** Stable mutation key for `useWriteFile` — lets components like the
 *  file tree subscribe via `useMutationState` to surface in-flight saves
 *  per path without prop-drilling through the viewer. */
export const WRITE_FILE_MUTATION_KEY = (sessionId: string) =>
  ['session', sessionId, 'write-file'] as const;

export function useWriteFile(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: WRITE_FILE_MUTATION_KEY(sessionId),
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      sessionsApi.writeFile(sessionId, path, content),
    onSuccess: (_data, vars) => {
      // Push the just-saved content into the file cache so navigating
      // away and back doesn't briefly flash the pre-save version.
      // Without this, the user sees stale cached content render first,
      // then a refetch lands and the editor jumps to the new version.
      // The invalidation below still triggers a background refetch for
      // correctness — it should land identically and produce no flicker.
      qc.setQueryData<FileResponse>(
        ['session', sessionId, 'file', vars.path],
        (prev) => (prev ? { ...prev, content: vars.content } : prev),
      );
      invalidateWorktree(qc, sessionId);
      qc.invalidateQueries({ queryKey: ['session', sessionId, 'file', vars.path] });
    },
  });
}

export function useDeletePath(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => sessionsApi.deleteFile(sessionId, path),
    onSuccess: (_data, path) => {
      invalidateWorktree(qc, sessionId);
      qc.invalidateQueries({ queryKey: ['session', sessionId, 'file', path] });
    },
  });
}

export function useCreateFile(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => sessionsApi.createFile(sessionId, path),
    onSuccess: (_data, path) => {
      invalidateWorktree(qc, sessionId);
      qc.invalidateQueries({ queryKey: ['session', sessionId, 'file', path] });
    },
  });
}

export function useRenamePath(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) =>
      sessionsApi.renamePath(sessionId, from, to),
    onSuccess: (_data, vars) => {
      invalidateWorktree(qc, sessionId);
      qc.invalidateQueries({ queryKey: ['session', sessionId, 'file', vars.from] });
      qc.invalidateQueries({ queryKey: ['session', sessionId, 'file', vars.to] });
    },
  });
}

export function useCreateDir(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => sessionsApi.createDir(sessionId, path),
    onSuccess: () => invalidateWorktree(qc, sessionId),
  });
}

export function useDeleteDir(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => sessionsApi.deleteDir(sessionId, path),
    onSuccess: () => invalidateWorktree(qc, sessionId),
  });
}

/**
 * "Commit" action — injects a prompt asking the agent to draft a focused
 * message from the diff and run `git commit` (and, when `andPush`, push
 * to origin). Mirrors `useOpenPr` — no message arg, no modal; the agent
 * writes the message itself. Invalidates worktree state on dispatch so
 * the action bar repaints once the agent's turn lands the commit.
 */
export function useCommit(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts?: { andPush?: boolean }) => sessionsApi.commit(id, opts),
    onSuccess: () => {
      invalidateWorktree(qc, id);
      qc.invalidateQueries({ queryKey: ['session', id, 'pr'] });
      qc.invalidateQueries({ queryKey: ['session', id, 'status'] });
    },
  });
}

export function usePush(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sessionsApi.push(id),
    onSuccess: () => {
      invalidateWorktree(qc, id);
      // PR head may have just moved — let the action bar re-query gh.
      qc.invalidateQueries({ queryKey: ['session', id, 'pr'] });
    },
  });
}

export function usePullBase(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (strategy?: 'merge' | 'rebase') => sessionsApi.pullBase(id, strategy ?? 'merge'),
    onSuccess: () => invalidateWorktree(qc, id),
  });
}

/**
 * Retry worktree provisioning after a setup failure. Used by the Pull
 * button on the SetupCard when the initial dispatch couldn't fetch the
 * PR head ref (auth, network, missing remote, etc.).
 */
export function useRetrySetup(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sessionsApi.retrySetup(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SESSION_KEY(id) });
      qc.invalidateQueries({ queryKey: ['workspaces'] });
      qc.invalidateQueries({ queryKey: ['sessions', 'rail'] });
    },
  });
}

/** Re-run the workspace setup script after a background-setup failure. */
export function useRetrySetupScript(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sessionsApi.retrySetupScript(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SESSION_KEY(id) });
    },
  });
}

/**
 * Conductor-style "Continue" — unarchive an archived execution AND
 * re-provision a fresh worktree off the workspace base. Returns
 * immediately with `worktreePath:null`; the UI's existing setting-up
 * spinner runs until the background provisioner stamps the new
 * path/branch/baseSha. Fired automatically from `ExecutionView` on mount
 * when the session is archived — the user never sees an explicit button,
 * opening the view IS the resume signal.
 */
export function useContinueSession(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts?: { baseBranch?: string | null }) =>
      sessionsApi.continueWork(id, opts),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SESSION_KEY(id) });
      qc.invalidateQueries({ queryKey: ['workspaces'] });
      qc.invalidateQueries({ queryKey: ['sessions', 'rail'] });
    },
  });
}

/**
 * Start a fresh chat against the same execution (new conversation on the
 * existing worktree), optionally switching provider. Returns the new session;
 * the caller navigates to it (e.g. `setActiveView(session.id)`).
 */
export function useNewExecutionChat(id: string) {
  const qc = useQueryClient();
  return useMutation({
    // `| void` keeps the no-arg "new chat" button working alongside the
    // composer's `{ providerId, model }` switch.
    mutationFn: (opts: { providerId?: 'claude' | 'codex'; model?: string | null } | void) =>
      sessionsApi.newChat(id, opts ?? undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions', 'rail'] });
      qc.invalidateQueries({ queryKey: ['workspaces'] });
      qc.invalidateQueries({ queryKey: ['session', id, 'history'] });
    },
  });
}

/** Past + current chats for an execution (history dropdown). */
export function useExecutionChatHistory(id: string | null, enabled = true) {
  return useQuery({
    queryKey: ['session', id, 'history'],
    queryFn: () => sessionsApi.chatHistory(id!),
    enabled: enabled && !!id,
    staleTime: 10_000,
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
        sessionId: id,
        role: 'user',
        source: 'user',
        content: input.content,
        attachments: input.attachments ?? [],
        createdAt: new Date().toISOString(),
        toolName: null,
        toolInput: null,
        toolIsError: null,
        toolExitCode: null,
        externalEventId: null,
        externalMessageId: null,
        externalTurnId: null,
        externalToolCallId: null,
        externalParentToolCallId: null,
        sourcePartIndex: 0,
        raw: null,
      };
      // Retry path: a previous failed bubble with the same id is
      // promoted back to in-flight rather than re-inserted, so the
      // user sees the spinner return on the bubble they clicked
      // rather than a phantom new row above it.
      qc.setQueryData<ChatEventRecord[]>(eventsKey, (prev) => {
        const list = prev ?? [];
        const existing = list.findIndex((e) => e.id === input.eventId);
        const next = existing >= 0 ? [...list] : [...list, placeholder];
        if (existing >= 0) next[existing] = placeholder;
        return next;
      });
      clearClientStatus(qc, eventsKey, input.eventId);
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
      clearClientStatus(qc, eventsKey, realEvent.id);
      qc.invalidateQueries({ queryKey: ['session', id] });
      qc.invalidateQueries({ queryKey: ['workspaces'] });
    },
    onError: (err, input) => {
      // Keep the optimistic bubble around but mark it failed so the
      // renderer can show a retry CTA. Silent rollback (the old
      // behavior) was the root cause of "I sent a message and it
      // disappeared" — the row never reached the DB and the
      // optimistic vanished, leaving the user with no signal that
      // their click failed.
      setClientStatus(qc, eventsKey, input.eventId, {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
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

/**
 * Retry a previously-failed send. Picks up the marker content and
 * attachments off the failed bubble in cache, re-fires the POST with
 * the *same* event id so the same DOM node transitions failed → sending
 * → sent without an unmount.
 */
export function useRetrySend(sessionId: string) {
  const qc = useQueryClient();
  const eventsKey = ['session', sessionId, 'events'] as const;
  return useMutation<ChatEventRecord, Error, { eventId: string }>({
    mutationFn: async ({ eventId }) => {
      const events = qc.getQueryData<ChatEventRecord[]>(eventsKey) ?? [];
      const target = events.find((e) => e.id === eventId);
      if (!target) {
        throw new Error('Original message no longer in cache');
      }
      return sessionsApi.sendMessage(sessionId, target.content ?? '', {
        attachments: (target.attachments ?? undefined) as Attachment[] | undefined,
        eventId: target.id,
      });
    },
    onMutate: ({ eventId }) => {
      // Flip the failed bubble back to a sending state. The send
      // mutation's onSuccess will replace the row with the persisted
      // version once the POST resolves; SSE-driven content from the
      // agent flows in via the chat-events cache as usual.
      setClientStatus(qc, eventsKey, eventId, { status: 'sending' });
    },
    onSuccess: (realEvent) => {
      qc.setQueryData<ChatEventRecord[]>(eventsKey, (prev) => {
        if (!prev) return prev;
        return prev.map((e) => (e.id === realEvent.id ? realEvent : e));
      });
      clearClientStatus(qc, eventsKey, realEvent.id);
      qc.invalidateQueries({ queryKey: ['session', sessionId] });
    },
    onError: (err, { eventId }) => {
      setClientStatus(qc, eventsKey, eventId, {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    },
  });
}

/**
 * Client-only status table for chat events. The DB doesn't carry a
 * "failed to send" column — it's transient UI state for optimistic
 * placeholders that never persisted. Stored in its own query cache so
 * the read side can subscribe without churning the events list.
 *
 * Keyed by event id. Cleared once the persisted row arrives.
 */
export interface ClientEventStatus {
  status: 'sending' | 'failed';
  error?: string;
}

const clientStatusKey = (sessionId: string) =>
  ['session', sessionId, 'client-status'] as const;

function setClientStatus(
  qc: ReturnType<typeof useQueryClient>,
  eventsKey: readonly unknown[],
  eventId: string,
  status: ClientEventStatus,
): void {
  const sessionId = (eventsKey[1] as string);
  qc.setQueryData<Record<string, ClientEventStatus>>(clientStatusKey(sessionId), (prev) => ({
    ...(prev ?? {}),
    [eventId]: status,
  }));
}

function clearClientStatus(
  qc: ReturnType<typeof useQueryClient>,
  eventsKey: readonly unknown[],
  eventId: string,
): void {
  const sessionId = (eventsKey[1] as string);
  qc.setQueryData<Record<string, ClientEventStatus>>(clientStatusKey(sessionId), (prev) => {
    if (!prev || !prev[eventId]) return prev;
    const next = { ...prev };
    delete next[eventId];
    return next;
  });
}

/** Subscribe to client-only status for a session's events. */
export function useClientEventStatus(sessionId: string | null): Record<string, ClientEventStatus> {
  const qc = useQueryClient();
  const key = clientStatusKey(sessionId ?? '');
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => qc.getQueryData<Record<string, ClientEventStatus>>(key) ?? {},
    enabled: !!sessionId,
    initialData: () => qc.getQueryData<Record<string, ClientEventStatus>>(key) ?? {},
  });
  return data ?? {};
}

export function useUpdateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: {
      id: string;
      label?: string | null;
      executionLabel?: string | null;
      permissionMode?: PermissionMode;
      model?: string | null;
      effort?: EffortLevel | null;
      prNumber?: number | null;
    }) => sessionsApi.update(id, input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['session', data.id] });
      qc.invalidateQueries({ queryKey: ['session', data.id, 'pr'] });
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

/**
 * User-pressable Resync — the deterministic recovery fallback for when
 * the per-send / per-view / sweep auto-checks haven't healed a session
 * the user perceives as stuck. Force-closes the cached AgentSession,
 * force-reconciles, bypasses the orphan redispatch throttle.
 *
 * Invalidates events + runtime so any state the resync just changed
 * repaints immediately.
 */
export function useResyncSession(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sessionsApi.resync(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['session', id, 'events'] });
      qc.invalidateQueries({ queryKey: ['session', id, 'runtime-status'] });
      qc.invalidateQueries({ queryKey: ['session', id, 'pending-input'] });
      qc.invalidateQueries({ queryKey: ['sessions', 'rail'] });
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

/**
 * Stop one background task (a backgrounded shell/server or async subagent).
 * The kill is async: the task's terminal `task_updated`/`task_notification`
 * arrives on the event stream, which re-derives the background-tasks list — so
 * no manual cache surgery here. `{ stopped: false }` is a normal outcome
 * (provider lacks per-task stop, or the task already ended).
 */
export function useStopBackgroundTask(id: string) {
  return useMutation({
    mutationFn: (taskId: string) => sessionsApi.stopTask(id, taskId),
  });
}

// ─── Picker / References / Scratchpad ─────────────────────────

/**
 * Resolved task + note lookups for transcript chip rendering. Cached
 * per-session; refetches when the events query invalidates (so new
 * mentions show up after a turn).
 */
export function useSessionEntities(id: string | null) {
  return useQuery({
    queryKey: ['session', id, 'entities'] as const,
    queryFn: () => sessionsApi.entities(id!),
    enabled: !!id,
    staleTime: 30_000,
  });
}

/**
 * Tasks + notes surfaced in the composer's `@`-picker. Scoped to the
 * session's workspace by default; the popup widens via the `all` toggle
 * when the user wants cross-workspace search.
 */
export function usePicker(id: string | null, opts?: { all?: boolean }) {
  return useQuery({
    queryKey: ['session', id, 'picker', opts?.all ? 'all' : 'workspace'] as const,
    queryFn: () => sessionsApi.picker(id!, opts),
    enabled: !!id,
    // Stale-but-cheap is fine — re-fetch on focus picks up new tasks.
    staleTime: 30_000,
  });
}

/**
 * Three-section dataset that powers the references slide-over. The
 * server computes section membership (in-chat / workspace / all) so the
 * client can render without re-doing the precedence logic.
 */
export function useSessionReferences(
  id: string | null,
  scope: 'session' | 'workspace' | 'all' = 'session',
) {
  return useQuery({
    queryKey: ['session', id, 'references', scope] as const,
    queryFn: () => sessionsApi.references(id!, { scope }),
    enabled: !!id,
    staleTime: 10_000,
  });
}

export function usePinSessionRef(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { entityType: 'task' | 'note' | 'area'; entityId: string }) =>
      sessionsApi.pinRef(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['session', id, 'references'] });
    },
  });
}

export function useUnpinSessionRef(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { entityType: 'task' | 'note' | 'area'; entityId: string }) =>
      sessionsApi.unpinRef(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['session', id, 'references'] });
    },
  });
}

export function useScratchpad(id: string | null) {
  return useQuery({
    queryKey: ['session', id, 'scratchpad'] as const,
    queryFn: () => sessionsApi.scratchpad(id!),
    enabled: !!id,
    // Don't refetch on focus — the user is actively editing locally;
    // a remote refetch would clobber unsaved changes.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
}

export function useSetScratchpad(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scratchPad: string | null) => sessionsApi.setScratchpad(id, scratchPad),
    // Optimistic so the editor doesn't flash. The cache holds the same
    // shape the GET returns.
    onMutate: async (scratchPad) => {
      await qc.cancelQueries({ queryKey: ['session', id, 'scratchpad'] });
      const prior = qc.getQueryData<{ scratchPad: string | null }>([
        'session', id, 'scratchpad',
      ]);
      qc.setQueryData(['session', id, 'scratchpad'], { scratchPad });
      return { prior };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prior) {
        qc.setQueryData(['session', id, 'scratchpad'], ctx.prior);
      }
    },
  });
}
