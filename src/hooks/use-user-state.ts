import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { userStateApi } from '@/lib/api/user-state';
import { resolveOrchestratorName } from '@/lib/orchestrator/name';
import { attachmentUrl } from '@/lib/attachments/view';
import type { UpdateUserStateInput, UserStateRecord } from '@/db/types';

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
    meta: { carriesInput: true },
    mutationFn: (input: UpdateUserStateInput) => userStateApi.update(input),
    // A partial merge into the cached row, so a setting (a rename in the
    // rail, a toggle) shows this frame rather than after a refetch. The
    // server may normalize what it stores (the orchestrator's name is folded
    // to one line), and the settle refetch brings that back.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: USER_STATE_KEY });
      const previous = qc.getQueryData<UserStateRecord>(USER_STATE_KEY);
      if (previous) qc.setQueryData<UserStateRecord>(USER_STATE_KEY, { ...previous, ...input });
      return { previous };
    },
    onError: (_err, _input, context) => {
      if (context?.previous) qc.setQueryData(USER_STATE_KEY, context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: USER_STATE_KEY }),
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
