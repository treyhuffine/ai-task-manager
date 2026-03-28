import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { streamApi } from '@/lib/api/stream';
import type { CreateStreamInput, StreamFilter, UpdateStreamInput } from '@/db/types';

const STREAM_KEY = ['stream'] as const;

export function useStream(filter?: StreamFilter) {
  return useQuery({
    queryKey: [...STREAM_KEY, filter],
    queryFn: () => streamApi.list(filter),
  });
}

export function usePendingStreamCount() {
  const { data } = useStream({ status: 'pending' });
  return data?.length ?? 0;
}

export function useDismissStream() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => streamApi.dismiss(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: STREAM_KEY }),
  });
}

export function useCreateStream() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStreamInput) => streamApi.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: STREAM_KEY }),
  });
}

export function useUpdateStream() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateStreamInput & { id: string }) =>
      streamApi.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: STREAM_KEY }),
  });
}
