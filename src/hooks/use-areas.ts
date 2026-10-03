import { trpc } from '@/lib/trpc/client';
import { entityKeys } from '@/lib/query/entity-keys';
import type { RouterInputs } from '@/lib/trpc/router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { areasApi } from '@/lib/api/areas';
import {
  optimisticPatch,
  rollbackOptimistic,
  settleEntity,
} from '@/lib/query/optimistic-entity';
import type { AreaFilter } from '@/db/types';

export function useAreas(filter?: AreaFilter) {
  return useQuery({
    ...trpc.areas.list.queryOptions(filter),
  });
}

export function useArea(id: string | null) {
  return useQuery({
    ...trpc.areas.get.queryOptions({ id: id ?? '' }),
    enabled: !!id,
  });
}

export function useCreateArea() {
  const qc = useQueryClient();
  return useMutation(trpc.areas.create.mutationOptions({
    meta: { carriesInput: true },
    onSuccess: (record) => qc.setQueryData(entityKeys.areas.detail(record.id), record),
    onSettled: () => settleEntity(qc, 'areas'),
  }));
}

export function useUpdateArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: trpc.areas.update.mutationKey(),
    meta: { carriesInput: true },
    mutationFn: ({ id, ...input }: RouterInputs['areas']['update']['patch'] & { id: string }) =>
      areasApi.update(id, input),
    onMutate: async ({ id, ...input }) => ({
      snapshot: await optimisticPatch(qc, 'areas', id, input),
    }),
    onError: (_err, _vars, ctx) => {
      rollbackOptimistic(qc, ctx?.snapshot);
      toast.error('Could not save changes', { id: 'save-changes-failed' });
    },
    onSettled: () => settleEntity(qc, 'areas'),
  });
}
