/**
 * TanStack Query hooks for schedules + runs. Mutations invalidate the
 * list query so the UI reflects new state without manual refetches.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { schedulesApi, runsApi } from '@/lib/api/schedules';
import type {
  CreateScheduleInput,
  UpdateScheduleInput,
  RunStatus,
  RunTrigger,
} from '@/db/types';

const SCHEDULES_KEY = ['schedules'] as const;
const RUNS_KEY = ['runs'] as const;

export function useSchedules(filter?: Parameters<typeof schedulesApi.list>[0]) {
  return useQuery({
    queryKey: [...SCHEDULES_KEY, filter],
    queryFn: () => schedulesApi.list(filter),
    refetchInterval: 30_000,
  });
}

export function useSchedule(id: string | null) {
  return useQuery({
    queryKey: [...SCHEDULES_KEY, id],
    queryFn: () => schedulesApi.get(id!),
    enabled: !!id,
    refetchInterval: 30_000,
  });
}

export function useCreateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreateScheduleInput, 'agentId'> & { agentId?: string }) =>
      schedulesApi.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: SCHEDULES_KEY }),
  });
}

export function useUpdateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateScheduleInput & { id: string }) =>
      schedulesApi.update(id, input),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: SCHEDULES_KEY });
      if (row?.id) qc.invalidateQueries({ queryKey: [...SCHEDULES_KEY, row.id] });
    },
  });
}

export function useDeleteSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => schedulesApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: SCHEDULES_KEY }),
  });
}

export function useRunSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => schedulesApi.run(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SCHEDULES_KEY });
      qc.invalidateQueries({ queryKey: RUNS_KEY });
    },
  });
}

export function useResetScheduleFailures() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => schedulesApi.resetFailures(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: SCHEDULES_KEY }),
  });
}

export function useRuns(filter?: {
  status?: RunStatus | RunStatus[];
  trigger?: RunTrigger | RunTrigger[];
  scheduleId?: string;
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
