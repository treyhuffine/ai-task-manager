import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { areasApi } from '@/lib/api/areas';
import {
  optimisticPatch,
  rollbackOptimistic,
  settleEntity,
} from '@/lib/query/optimistic-entity';
import type { CreateAreaInput, AreaFilter, UpdateAreaInput } from '@/db/types';

const AREAS_KEY = ['areas'] as const;

export function useAreas(filter?: AreaFilter) {
  return useQuery({
    queryKey: [...AREAS_KEY, filter],
    queryFn: () => areasApi.list(filter),
  });
}

export function useArea(id: string | null) {
  return useQuery({
    queryKey: [...AREAS_KEY, id],
    queryFn: () => areasApi.get(id!),
    enabled: !!id,
  });
}

export function useCreateArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: AREAS_KEY,
    mutationFn: (input: CreateAreaInput) => areasApi.create(input),
    onSuccess: (record) => qc.setQueryData([...AREAS_KEY, record.id], record),
    onSettled: () => settleEntity(qc, 'areas'),
  });
}

export function useUpdateArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: AREAS_KEY,
    mutationFn: ({ id, ...input }: UpdateAreaInput & { id: string }) =>
      areasApi.update(id, input),
    onMutate: async ({ id, ...input }) => ({
      snapshot: await optimisticPatch(qc, 'areas', id, input),
    }),
    onError: (_err, _vars, ctx) => {
      rollbackOptimistic(qc, ctx?.snapshot);
      toast.error('Could not save changes');
    },
    onSettled: () => settleEntity(qc, 'areas'),
  });
}
