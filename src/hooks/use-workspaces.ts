import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { workspacesApi } from '@/lib/api/workspaces';
import { sessionsApi, type RailResponse } from '@/lib/api/sessions';
import type {
  ChatSessionRecord,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  WorkspaceStatus,
} from '@/db/types';

const WORKSPACES_KEY = ['workspaces'] as const;
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

export function useDiffStats(sessionId: string | null) {
  return useQuery({
    queryKey: ['sessions', sessionId, 'diff-stats'],
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
    }: {
      workspaceId: string;
      label?: string | null;
      baseBranch?: string | null;
      prNumber?: number | null;
      liveMode?: boolean;
    }) =>
      workspacesApi.createSession(workspaceId, { label, baseBranch, prNumber, liveMode }),
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

export function useArchiveSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) =>
      sessionsApi.archive(id, { force }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WORKSPACES_KEY });
      qc.invalidateQueries({ queryKey: NEEDS_REVIEW_KEY });
      qc.invalidateQueries({ queryKey: RAIL_KEY });
    },
  });
}
