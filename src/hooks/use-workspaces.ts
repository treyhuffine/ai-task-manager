import { useQuery, useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { workspacesApi, type StackSuggestion } from '@/lib/api/workspaces';
import { sessionsApi, type RailResponse } from '@/lib/api/sessions';
import { worktreeScopeFor } from '@/hooks/use-execution';
import { ApiError } from '@/lib/api/client';
import type {
  ChatSessionRecord,
  ChatSessionWithExecution,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  WorkspaceStatus,
  EffortLevel,
} from '@/db/types';

const WORKSPACES_KEY = ['workspaces'] as const;

/** Detected setup/start command suggestions for a checkout (placeholders only). */
export function useStackDetection(cwd: string | null) {
  return useQuery<StackSuggestion>({
    queryKey: ['stack-detect', cwd],
    queryFn: () => workspacesApi.detectStack(cwd!),
    enabled: !!cwd && cwd.trim().length > 0,
    staleTime: 60_000,
  });
}

const NEEDS_REVIEW_KEY = ['sessions', 'needs-review'] as const;
const RAIL_KEY = ['sessions', 'rail'] as const;
const HISTORY_KEY = ['sessions', 'history'] as const;

export function useWorkspaces(filter?: { status?: WorkspaceStatus }) {
  return useQuery({
    queryKey: [...WORKSPACES_KEY, filter],
    queryFn: () => workspacesApi.list(filter),
  });
}

export function useWorkspace(id: string | null) {
  return useQuery({
    queryKey: [...WORKSPACES_KEY, id],
    queryFn: () => workspacesApi.get(id!),
    enabled: !!id,
  });
}

export function useWorkspaceSessions(id: string | null) {
  return useQuery({
    queryKey: [...WORKSPACES_KEY, id, 'sessions'],
    queryFn: () => workspacesApi.sessions(id!),
    enabled: !!id,
  });
}

export function useNeedsReviewSessions() {
  return useQuery({
    queryKey: NEEDS_REVIEW_KEY,
    queryFn: () => sessionsApi.needsReview(),
    refetchInterval: 5_000,
  });
}

/**
 * Shortstat badge for a session's worktree.
 *
 * Takes `executionId` explicitly rather than resolving it through the
 * session cache: this runs once per rail row, and looking each one up
 * would fire a session fetch per row. Rail rows already carry the field.
 *
 * Scoped to the execution because the diff belongs to the worktree — that
 * also puts it under the same prefix `invalidateWorktree` sweeps, which is
 * what makes the badge repaint after a commit. It previously sat under a
 * `['sessions', …]` (plural) key that no invalidation ever matched.
 */
export function useDiffStats(sessionId: string | null, executionId: string | null) {
  const scope = sessionId ? worktreeScopeFor(executionId, sessionId) : null;
  return useQuery({
    queryKey: [...(scope ?? ['session', '__none__']), 'diff-stats'],
    queryFn: () => sessionsApi.diffStats(sessionId!),
    enabled: !!sessionId,
    staleTime: 5_000,
  });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<CreateWorkspaceInput> & { name: string; cwd: string }) =>
      workspacesApi.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: WORKSPACES_KEY }),
  });
}

export function useUpdateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateWorkspaceInput & { id: string }) =>
      workspacesApi.update(id, input),
    // Rail rows carry a join-cached copy of workspace icon/emoji/attachments
    // (see listRailSessions), so a workspace edit has to bust both caches
    // — otherwise the rail keeps the old glyph until the next 15s poll.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WORKSPACES_KEY });
      qc.invalidateQueries({ queryKey: RAIL_KEY });
    },
  });
}

export function useArchiveWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => workspacesApi.archive(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: WORKSPACES_KEY }),
  });
}

export function useReorderWorkspaces() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => workspacesApi.reorder(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: WORKSPACES_KEY }),
  });
}

export function useCreateExecution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceId,
      label,
      baseBranch,
      prNumber,
      liveMode,
      harness,
      model,
      modelVariant,
      effort,
    }: {
      workspaceId: string;
      label?: string | null;
      baseBranch?: string | null;
      prNumber?: number | null;
      liveMode?: boolean;
      harness?: string | null;
      model?: string | null;
      modelVariant?: string | null;
      effort?: EffortLevel | null;
    }) =>
      workspacesApi.createSession(workspaceId, {
        label,
        baseBranch,
        prNumber,
        liveMode,
        harness,
        model,
        modelVariant,
        effort,
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: [...WORKSPACES_KEY, vars.workspaceId, 'sessions'] });
      qc.invalidateQueries({ queryKey: WORKSPACES_KEY });
    },
  });
}

export function useWorkspacePRs(id: string | null) {
  return useQuery({
    queryKey: [...WORKSPACES_KEY, id, 'github', 'prs'],
    queryFn: () => workspacesApi.listPRs(id!),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useWorkspaceIssues(id: string | null) {
  return useQuery({
    queryKey: [...WORKSPACES_KEY, id, 'github', 'issues'],
    queryFn: () => workspacesApi.listIssues(id!),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useWorkspaceBranches(id: string | null) {
  return useQuery({
    queryKey: [...WORKSPACES_KEY, id, 'branches'],
    queryFn: () => workspacesApi.listBranches(id!),
    enabled: !!id,
    staleTime: 30_000,
  });
}

/**
 * @deprecated Aliased to `useMarkSessionRead`. Kept so older callers (the
 * execution view's "opening marks read" effect) compile while they migrate
 * to the interaction-driven read receipt.
 */
export function useMarkSessionViewed() {
  return useMarkSessionRead();
}

export function useMarkSessionRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sessionsApi.markRead(id),
    // Optimistic update: flip the read state in every rail-feeding
    // cache before the server round-trip. Otherwise the user can
    // navigate away from a chat and still see the unread pip on the
    // row for the brief window between mutation send and refetch
    // settle — which feels broken because the click-out gesture
    // didn't seem to "do" anything.
    onMutate: async (id) => {
      const now = new Date().toISOString();
      qc.setQueryData<RailResponse>(RAIL_KEY, (prev) => prev && {
        ...prev,
        sessions: prev.sessions.map((s) =>
          s.id === id
            ? { ...s, lastViewedAt: now, unreadMarkerAt: null }
            : s,
        ),
      });
      qc.setQueryData<ChatSessionRecord[]>(NEEDS_REVIEW_KEY, (prev) =>
        prev ? prev.filter((s) => s.id !== id) : prev,
      );
      // Every workspace's sessions cache that contains this row gets
      // the same field bump — there are many such caches (one per
      // workspace), so we match by predicate and update in place.
      qc.setQueriesData<ChatSessionRecord[]>(
        { predicate: (q) =>
          q.queryKey[0] === 'workspaces'
          && q.queryKey[2] === 'sessions' },
        (prev) => prev?.map((s) =>
          s.id === id
            ? { ...s, lastViewedAt: now, unreadMarkerAt: null }
            : s,
        ),
      );
    },
    onSettled: () => {
      // Invalidate after the server confirms so the cache converges
      // to the server's canonical timestamps (the optimistic `now`
      // is close but not identical to the server's).
      qc.invalidateQueries({ queryKey: NEEDS_REVIEW_KEY });
      qc.invalidateQueries({ queryKey: WORKSPACES_KEY });
      qc.invalidateQueries({ queryKey: RAIL_KEY });
    },
  });
}

export function useMarkSessionUnread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sessionsApi.markUnread(id),
    // Mirror: flip back to unread locally so the kebab → Mark unread
    // affordance feels instant.
    onMutate: async (id) => {
      const now = new Date().toISOString();
      qc.setQueryData<RailResponse>(RAIL_KEY, (prev) => prev && {
        ...prev,
        sessions: prev.sessions.map((s) =>
          s.id === id ? { ...s, unreadMarkerAt: now } : s,
        ),
      });
      qc.setQueriesData<ChatSessionRecord[]>(
        { predicate: (q) =>
          q.queryKey[0] === 'workspaces'
          && q.queryKey[2] === 'sessions' },
        (prev) => prev?.map((s) =>
          s.id === id ? { ...s, unreadMarkerAt: now } : s,
        ),
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: NEEDS_REVIEW_KEY });
      qc.invalidateQueries({ queryKey: WORKSPACES_KEY });
      qc.invalidateQueries({ queryKey: RAIL_KEY });
    },
  });
}

/**
 * Rail data: all active sessions joined with workspace metadata, plus
 * snapshots of pending-input and running session IDs. The global SSE
 * stream (`useGlobalSessionStream`) invalidates this query on
 * `session_updated` frames, so client-side polling is just a safety net.
 */
export function useRailSessions() {
  return useQuery({
    queryKey: RAIL_KEY,
    queryFn: () => sessionsApi.rail(),
    refetchInterval: 15_000,
  });
}

/**
 * Execution history feed for the "By history" rail tab. Includes active
 * AND archived executions across every workspace, capped server-side at
 * 200. Refresh interval is slower than the rail's because the history
 * surface is less time-critical — the SSE invalidation on session
 * updates handles the fresh-data needs.
 */
export function useHistorySessions(enabled: boolean = true) {
  return useQuery({
    queryKey: HISTORY_KEY,
    queryFn: () => sessionsApi.history(),
    enabled,
    refetchInterval: 60_000,
  });
}

/** Snapshot of a cache entry we mutated optimistically, for rollback. */
type CacheSnapshot = [QueryKey, unknown];

/**
 * Drop a session id from every rail-facing cache (workspace trees,
 * needs-review, the rail GET) and return the prior values so a failed
 * mutation can restore them. Deliberately leaves the History cache alone
 * — archived executions still belong there, just flipped in status.
 */
function dropSessionFromCaches(
  qc: ReturnType<typeof useQueryClient>,
  id: string,
): CacheSnapshot[] {
  const snapshots: CacheSnapshot[] = [];

  // Per-workspace session lists live at ['workspaces', <id>, 'sessions'].
  for (const [key, data] of qc.getQueriesData<ChatSessionWithExecution[]>({
    queryKey: WORKSPACES_KEY,
  })) {
    if (key.length === 3 && key[2] === 'sessions' && Array.isArray(data)) {
      snapshots.push([key, data]);
      qc.setQueryData(
        key,
        data.filter((s) => s.id !== id),
      );
    }
  }

  const needsReview = qc.getQueryData<ChatSessionWithExecution[]>(NEEDS_REVIEW_KEY);
  if (needsReview) {
    snapshots.push([NEEDS_REVIEW_KEY, needsReview]);
    qc.setQueryData(
      NEEDS_REVIEW_KEY,
      needsReview.filter((s) => s.id !== id),
    );
  }

  const rail = qc.getQueryData<RailResponse>(RAIL_KEY);
  if (rail) {
    snapshots.push([RAIL_KEY, rail]);
    qc.setQueryData<RailResponse>(RAIL_KEY, {
      ...rail,
      sessions: rail.sessions.filter((s) => s.id !== id),
    });
  }

  return snapshots;
}

/**
 * Archive a single execution. The row vanishes from the rail immediately
 * (optimistic remove across all session caches); a failed request rolls
 * the snapshots back so the row reappears exactly where it was. The
 * dirty-worktree 409 is an expected "failure" here — the caller catches
 * it, the optimistic remove rolls back, and the row is gone again once
 * the user confirms the force pass.
 */
export function useArchiveSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) =>
      sessionsApi.archive(id, { force }),
    onMutate: async ({ id }) => {
      // Halt in-flight refetches so they can't clobber the optimistic
      // edit with stale (pre-archive) data mid-request.
      await Promise.all([
        qc.cancelQueries({ queryKey: WORKSPACES_KEY }),
        qc.cancelQueries({ queryKey: NEEDS_REVIEW_KEY }),
        qc.cancelQueries({ queryKey: RAIL_KEY }),
      ]);
      return { snapshots: dropSessionFromCaches(qc, id) };
    },
    onError: (_err, _vars, context) => {
      for (const [key, data] of context?.snapshots ?? []) {
        qc.setQueryData(key, data);
      }
    },
    onSettled: () => {
      // Reconcile with the server on both success and (post-rollback)
      // failure so the caches match the truth.
      qc.invalidateQueries({ queryKey: WORKSPACES_KEY });
      qc.invalidateQueries({ queryKey: NEEDS_REVIEW_KEY });
      qc.invalidateQueries({ queryKey: RAIL_KEY });
    },
  });
}

/**
 * Outcome of a bulk archive pass, partitioned so the caller can decide
 * what to do next:
 *   - `succeeded` — cleanly archived.
 *   - `dirty` — refused with 409 `dirty_worktree`; archivable only by a
 *     second force pass (which discards local changes), so it's surfaced
 *     for an explicit confirm rather than forced silently.
 *   - `failed` — any other error, with a message for the user.
 */
export interface BulkArchiveResult {
  succeeded: string[];
  dirty: string[];
  failed: { id: string; message: string }[];
}

/**
 * Archive many executions in one pass. Runs the per-session archive
 * calls concurrently (`allSettled` so one failure never aborts the
 * batch) and buckets the results. Dirty-worktree conflicts are NOT
 * forced here — the caller re-invokes with `force: true` on just the
 * `dirty` ids after confirming the data loss.
 *
 * Mirrors `useArchiveSession`'s cache invalidation so both the single
 * and bulk paths refresh the same surfaces.
 */
export function useBulkArchiveSessions() {
  const qc = useQueryClient();
  return useMutation<BulkArchiveResult, Error, { ids: string[]; force?: boolean }>({
    mutationFn: async ({ ids, force }) => {
      const settled = await Promise.allSettled(
        ids.map((id) => sessionsApi.archive(id, { force }).then(() => id)),
      );
      const result: BulkArchiveResult = { succeeded: [], dirty: [], failed: [] };
      settled.forEach((outcome, i) => {
        const id = ids[i]!;
        if (outcome.status === 'fulfilled') {
          result.succeeded.push(id);
          return;
        }
        const err = outcome.reason;
        const isDirty =
          err instanceof ApiError &&
          err.status === 409 &&
          (err.body as { code?: string } | null)?.code === 'dirty_worktree';
        if (isDirty) {
          result.dirty.push(id);
        } else {
          result.failed.push({
            id,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WORKSPACES_KEY });
      qc.invalidateQueries({ queryKey: NEEDS_REVIEW_KEY });
      qc.invalidateQueries({ queryKey: RAIL_KEY });
    },
  });
}
