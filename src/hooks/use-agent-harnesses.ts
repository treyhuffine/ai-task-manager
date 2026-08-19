'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { AgentHarnessSettingsRecord, EffortLevel } from '@/db/types';
import type { ModelOption } from '@/lib/agent-options';
import type { HarnessDefinition, HarnessId } from '@/lib/agents/registry';
import type { HarnessRuntimeView } from '@/lib/agents/runtime';

export interface HarnessSettingsView extends HarnessDefinition {
  runtime: HarnessRuntimeView;
  settings: AgentHarnessSettingsRecord;
}

export function useAgentHarnesses() {
  return useQuery({
    queryKey: ['agent-harnesses'],
    queryFn: () => api.get<{ harnesses: HarnessSettingsView[] }>('/agent/harnesses'),
    staleTime: 60_000,
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
      makeActive?: boolean;
    }) => api.put<AgentHarnessSettingsRecord>('/agent/models/enabled', input),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: ['agent-models', input.harness] });
      void queryClient.invalidateQueries({ queryKey: ['agent-harnesses'] });
      void queryClient.invalidateQueries({ queryKey: ['user-state'] });
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
      api.post<{ settings: AgentHarnessSettingsRecord; model: ModelOption }>('/agent/models/custom', input),
    onSuccess: (_data, input) => invalidateHarnessModels(queryClient, input.harness),
  });
}

export function useRemoveCustomModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { harness: HarnessId; modelId: string }) =>
      api.delete<{ settings: AgentHarnessSettingsRecord }>('/agent/models/custom', {
        query: { harness: input.harness, modelId: input.modelId },
      }),
    onSuccess: (_data, input) => invalidateHarnessModels(queryClient, input.harness),
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
  harness: HarnessId,
): Promise<void> {
  await queryClient.refetchQueries({ queryKey: ['agent-models', harness] });
  void queryClient.invalidateQueries({ queryKey: ['agent-harnesses'] });
  void queryClient.invalidateQueries({ queryKey: ['user-state'] });
}
