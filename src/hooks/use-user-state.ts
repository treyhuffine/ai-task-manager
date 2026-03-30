import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { userStateApi } from '@/lib/api/user-state';
import type { UpdateUserStateInput } from '@/db/types';

const USER_STATE_KEY = ['user-state'] as const;

export function useUserState() {
  return useQuery({
    queryKey: USER_STATE_KEY,
    queryFn: () => userStateApi.get(),
  });
}

export function useUpdateUserState() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateUserStateInput) => userStateApi.update(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: USER_STATE_KEY }),
  });
}
