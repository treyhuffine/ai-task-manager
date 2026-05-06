import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { workspacesApi } from '@/lib/api/workspaces';
import { sessionsApi } from '@/lib/api/sessions';
import type {
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  WorkspaceStatus,
} from '@/db/types';

const WORKSPACES_KEY = ['workspaces'] as const;
const NEEDS_REVIEW_KEY = ['sessions', 'needs-review'] as const;

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
    onSuccess: () => qc.invalidateQueries({ queryKey: WORKSPACES_KEY }),
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
    }: {
      workspaceId: string;
      label?: string | null;
      baseBranch?: string | null;
    }) =>
      workspacesApi.createSession(workspaceId, { label, baseBranch }),
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

export function useMarkSessionViewed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sessionsApi.markViewed(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: NEEDS_REVIEW_KEY });
      qc.invalidateQueries({ queryKey: WORKSPACES_KEY });
    },
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
    },
  });
}
