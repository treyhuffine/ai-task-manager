'use client';

import type { EffortLevel, HarnessSettingsRecord } from '@/db/types';
import type { HarnessDefinition, HarnessId } from '@/lib/harness/registry';
import type { HarnessRuntimeView } from '@/lib/harness/runtime';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { rpcQuery } from '@/lib/trpc/request-options';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface HarnessSettingsView extends HarnessDefinition {
  runtime: HarnessRuntimeView;
  settings: HarnessSettingsRecord;
}

export function useHarnesses(enabled = true) {
  return useQuery({
    enabled,
    queryKey: trpc.harness.harnessesGet.queryKey(),
    queryFn: () => trpcClient.harness.harnessesGet.query({}),
    staleTime: 60_000,
    refetchInterval: false,
  });
}

export function useSaveHarnessModels() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      harness: HarnessId;
      enabledModelIds: string[];
      defaultModel: string | null;
      defaultVariant?: string | null;
      defaultEffort?: EffortLevel | null;
      defaultServiceTier?: string | null;
    }) => trpcClient.harness.modelsEnabledPut.mutate({body: input}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: trpc.harness.modelsGet.pathKey() });
      void queryClient.invalidateQueries({ queryKey: trpc.harness.harnessesGet.pathKey() });
    },
  });
}

/**
 * Pin an exact model id for a provider. The saved id becomes a normal,
 * selectable row everywhere the catalog is read, so callers only have to
 * refetch — the picker, the composer chip and every server-side validator all
 * resolve it the same way they resolve a discovered model.
 */
export function useAddCustomModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { harness: HarnessId; modelId: string }) =>
      trpcClient.harness.modelsCustomPost.mutate({body: input}),
    onSuccess: () => invalidateHarnessModels(queryClient),
  });
}

export function useRemoveCustomModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { harness: HarnessId; modelId: string }) =>
      trpcClient.harness.modelsCustomDelete.mutate({query: rpcQuery({ harness: input.harness, modelId: input.modelId })}),
    onSuccess: () => invalidateHarnessModels(queryClient),
  });
}

/**
 * Settle the reads a pin touches before the caller acts on it. `refetch`
 * rather than `invalidate`: consumers resolve a model id against these lists
 * immediately after mutating, and an invalidated-but-unfetched list resolves
 * to the wrong model silently (the resolver falls back rather than throwing).
 */
async function invalidateHarnessModels(
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<void> {
  await queryClient.refetchQueries({ queryKey: trpc.harness.modelsGet.pathKey() });
  void queryClient.invalidateQueries({ queryKey: trpc.harness.harnessesGet.pathKey() });
  void queryClient.invalidateQueries({ queryKey: trpc.userState.list.queryKey({}) });
}
