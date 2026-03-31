import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { areasApi } from '@/lib/api/areas';
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
    mutationFn: (input: CreateAreaInput) => areasApi.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: AREAS_KEY }),
  });
}

export function useUpdateArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateAreaInput & { id: string }) =>
      areasApi.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: AREAS_KEY }),
  });
}
