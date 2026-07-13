'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { AgentHarnessSettingsRecord, EffortLevel } from '@/db/types';
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
