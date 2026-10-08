import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { userStateApi } from '@/lib/api/user-state';
import { resolveOrchestratorName } from '@/lib/orchestrator/name';
import { attachmentUrl } from '@/lib/attachments/view';
import type { UpdateUserStateInput, UserStateRecord } from '@/db/types';
import { toast } from 'sonner';

const USER_STATE_KEY = ['user-state'] as const;
const UPDATE_USER_STATE_KEY = ['user-state', 'update'] as const;
const fieldWrites = new WeakMap<QueryClient, Map<keyof UpdateUserStateInput, object>>();

export function useUserState() {
  return useQuery({
    queryKey: USER_STATE_KEY,
    queryFn: () => userStateApi.get(),
  });
}

export function useUpdateUserState() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: UPDATE_USER_STATE_KEY,
    meta: { carriesInput: true },
    mutationFn: (input: UpdateUserStateInput) => userStateApi.update(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: USER_STATE_KEY });
      const previous = qc.getQueryData<UserStateRecord>(USER_STATE_KEY);
      const token = {};
      const writes = fieldWrites.get(qc) ?? new Map<keyof UpdateUserStateInput, object>();
      fieldWrites.set(qc, writes);
      for (const key of Object.keys(input) as Array<keyof UpdateUserStateInput>) writes.set(key, token);
      if (previous) qc.setQueryData(USER_STATE_KEY, { ...previous, ...input });
      return { previous, token };
    },
    onError: (_error, input, context) => {
      if (context?.previous) {
        qc.setQueryData<UserStateRecord>(USER_STATE_KEY, (current) => {
          if (!current) return context.previous;
          const restored = { ...current };
          for (const key of Object.keys(input) as Array<keyof UpdateUserStateInput>) {
            // Roll back this mutation's fields, preserving any newer choices.
            if (fieldWrites.get(qc)?.get(key) === context.token && Object.is(current[key], input[key])) {
              Object.assign(restored, { [key]: context.previous![key] });
            }
          }
          return restored;
        });
      }
      toast.error('Could not save settings. Try again.');
    },
    onSettled: () => {
      // A refetch from an earlier save would replace a later optimistic choice.
      // The current mutation remains pending until this callback returns.
      if (qc.isMutating({ mutationKey: UPDATE_USER_STATE_KEY }) === 1) {
        void qc.invalidateQueries({ queryKey: USER_STATE_KEY });
      }
    },
  });
}

/**
 * What the user calls the orchestrator (the app's main chat), resolved to the
 * default until they pick a name. See src/lib/orchestrator/name.ts.
 */
export function useOrchestratorName(): string {
  const { data } = useUserState();
  return resolveOrchestratorName(data?.orchestratorName);
}

export interface OrchestratorIdentity {
  name: string;
  emoji: string | null;
  /** Where its image is served, when it has one. */
  imageUrl: string | null;
  color: string | null;
}

/** The orchestrator's name and look, as `OrchestratorMark` draws them. */
export function useOrchestratorIdentity(): OrchestratorIdentity {
  const { data } = useUserState();
  return {
    name: resolveOrchestratorName(data?.orchestratorName),
    emoji: data?.orchestratorEmoji ?? null,
    imageUrl: data?.orchestratorImage ? attachmentUrl(data.orchestratorImage.fileName) : null,
    color: data?.orchestratorColor ?? null,
  };
}
