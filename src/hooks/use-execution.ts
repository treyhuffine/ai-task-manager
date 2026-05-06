import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionsApi } from '@/lib/api/sessions';

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

export function useSendMessage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => sessionsApi.sendMessage(id, content),
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
    mutationFn: ({ id, ...input }: { id: string; label?: string | null }) =>
      sessionsApi.update(id, input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['session', data.id] });
      qc.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
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
