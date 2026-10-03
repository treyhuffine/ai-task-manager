import type { NoteFilter } from '@/db/types';
import { notesApi } from '@/lib/api/notes';
import { documentSaves } from '@/lib/client/document-saves';
import { entityKeys } from '@/lib/query/entity-keys';
import {
	optimisticPatch,
	optimisticRemove,
	rollbackOptimistic,
	settleEntity,
} from '@/lib/query/optimistic-entity';
import { trpc } from '@/lib/trpc/client';
import type { RouterInputs } from '@/lib/trpc/router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export function useNotes(filter?: NoteFilter) {
  return useQuery({
    ...trpc.notes.list.queryOptions(filter),
  });
}

export function useNote(id: string | null) {
  return useQuery({
    ...trpc.notes.get.queryOptions({ id: id ?? '' }),
    enabled: !!id,
  });
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation(trpc.notes.create.mutationOptions({
    meta: { carriesInput: true },
    // See useCreateTask: seed the detail cache, leave list placement to settle.
    onSuccess: (record) => qc.setQueryData(entityKeys.notes.detail(record.id), record),
    onSettled: () => settleEntity(qc, 'notes'),
  }));
}

export function useUpdateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: trpc.notes.update.mutationKey(),
    meta: { carriesInput: true },
    mutationFn: ({ id, ...input }: RouterInputs['notes']['update']['patch'] & { id: string }) =>
      notesApi.update(id, input),
    onMutate: async ({ id, ...input }) => ({
      snapshot: await optimisticPatch(qc, 'notes', id, input),
    }),
    onError: (_err, _vars, ctx) => {
      rollbackOptimistic(qc, ctx?.snapshot);
      toast.error('Could not save changes', { id: 'save-changes-failed' });
    },
    onSettled: () => settleEntity(qc, 'notes'),
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: trpc.notes.delete.mutationKey(),
    mutationFn: async (id: string) => {
      await documentSaves.flush(`notes:${id}`);
      return notesApi.delete(id);
    },
    onMutate: async (id) => ({ snapshot: await optimisticRemove(qc, 'notes', id) }),
    onError: (_err, _id, ctx) => {
      rollbackOptimistic(qc, ctx?.snapshot);
      toast.error('Could not delete note');
    },
    onSettled: () => settleEntity(qc, 'notes'),
  });
}
