/**
 * TanStack Query hooks for triggers + runs. Mutations invalidate the
 * list query so the UI reflects new state without manual refetches.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { triggersApi, runsApi } from '@/lib/api/triggers';
import type {
  CreateTriggerInput,
  UpdateTriggerInput,
  RunStatus,
  RunTrigger,
} from '@/db/types';

const TRIGGERS_KEY = ['triggers'] as const;
const RUNS_KEY = ['runs'] as const;

export function useTriggers(filter?: Parameters<typeof triggersApi.list>[0]) {
  return useQuery({
    queryKey: [...TRIGGERS_KEY, filter],
    queryFn: () => triggersApi.list(filter),
    refetchInterval: 30_000,
  });
}

export function useTrigger(id: string | null) {
  return useQuery({
    queryKey: [...TRIGGERS_KEY, id],
    queryFn: () => triggersApi.get(id!),
    enabled: !!id,
    refetchInterval: 30_000,
  });
}

export function useCreateTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreateTriggerInput, 'agentId'> & { agentId?: string }) =>
      triggersApi.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: TRIGGERS_KEY }),
  });
}

export function useUpdateTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateTriggerInput & { id: string }) =>
      triggersApi.update(id, input),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: TRIGGERS_KEY });
      if (row?.id) qc.invalidateQueries({ queryKey: [...TRIGGERS_KEY, row.id] });
    },
  });
}

export function useDeleteTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => triggersApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: TRIGGERS_KEY }),
  });
}

export function useRunTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => triggersApi.run(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TRIGGERS_KEY });
      qc.invalidateQueries({ queryKey: RUNS_KEY });
    },
  });
}

export function useResetTriggerFailures() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => triggersApi.resetFailures(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: TRIGGERS_KEY }),
  });
}

export function useRuns(filter?: {
  status?: RunStatus | RunStatus[];
  trigger?: RunTrigger | RunTrigger[];
  triggerId?: string;
  executionId?: string;
  workspaceId?: string;
  since?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: [...RUNS_KEY, filter],
    queryFn: () => runsApi.list(filter),
    refetchInterval: 15_000,
  });
}
