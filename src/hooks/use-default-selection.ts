'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useUserState } from '@/hooks/use-user-state';
import { setDefaultSelection } from '@/lib/client/default-selection';
import type { EffortLevel } from '@/db/types';
import type { HarnessId } from '@/lib/harness/registry';

/**
 * The global default model (user state): the harness, model, variant
 * and effort new chats and executions start on. Null until one is chosen.
 */
export function useDefaultSelection(): {
  harness: HarnessId;
  model: string | null;
  variant: string | null;
  effort: EffortLevel | null;
  serviceTier?: string | null;
} | null {
  const { data } = useUserState();
  if (!data?.defaultHarness) return null;
  return {
    harness: data.defaultHarness as HarnessId,
    model: data.defaultModel ?? null,
    variant: data.defaultVariant ?? null,
    serviceTier: data.defaultServiceTier ?? null,
    effort: (data.defaultEffort ?? null) as EffortLevel | null,
  };
}

/** Make a selection the global default model, the way Settings does. */
export function useSetDefaultSelection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: setDefaultSelection,
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ['user-state'] });
      void qc.invalidateQueries({ queryKey: ['agent-models', saved.harness] });
      void qc.invalidateQueries({ queryKey: ['agent-harnesses'] });
    },
  });
}
