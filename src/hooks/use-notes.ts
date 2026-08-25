import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { notesApi } from '@/lib/api/notes';
import {
  optimisticPatch,
  optimisticRemove,
  rollbackOptimistic,
  settleEntity,
} from '@/lib/query/optimistic-entity';
import type {
  CreateNoteInput,
  UpdateNoteInput,
  NoteFilter,
} from '@/db/types';

const NOTES_KEY = ['notes'] as const;

export function useNotes(filter?: NoteFilter) {
  return useQuery({
    queryKey: [...NOTES_KEY, filter],
    queryFn: () => notesApi.list(filter),
  });
}

export function useNote(id: string | null) {
  return useQuery({
    queryKey: [...NOTES_KEY, id],
    queryFn: () => notesApi.get(id!),
    enabled: !!id,
  });
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: NOTES_KEY,
    mutationFn: (input: CreateNoteInput) => notesApi.create(input),
    // See useCreateTask: seed the detail cache, leave list placement to settle.
    onSuccess: (record) => qc.setQueryData([...NOTES_KEY, record.id], record),
    onSettled: () => settleEntity(qc, 'notes'),
  });
}

export function useUpdateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: NOTES_KEY,
    mutationFn: ({ id, ...input }: UpdateNoteInput & { id: string }) =>
      notesApi.update(id, input),
    onMutate: async ({ id, ...input }) => ({
      snapshot: await optimisticPatch(qc, 'notes', id, input),
    }),
    onError: (_err, _vars, ctx) => {
      rollbackOptimistic(qc, ctx?.snapshot);
      toast.error('Could not save changes');
    },
    onSettled: () => settleEntity(qc, 'notes'),
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: NOTES_KEY,
    mutationFn: (id: string) => notesApi.delete(id),
    onMutate: async (id) => ({ snapshot: await optimisticRemove(qc, 'notes', id) }),
    onError: (_err, _id, ctx) => {
      rollbackOptimistic(qc, ctx?.snapshot);
      toast.error('Could not delete note');
    },
    onSettled: () => settleEntity(qc, 'notes'),
  });
}
