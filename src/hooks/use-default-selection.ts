'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useUserState } from '@/hooks/use-user-state';
import { setDefaultSelection } from '@/lib/client/default-selection';
import type { HarnessId } from '@/lib/harness/registry';

/**
 * The home's default harness and model (user state), what new chats and
 * executions start on. Null until one is chosen.
 */
export function useDefaultSelection(): { harness: HarnessId; model: string | null } | null {
  const { data } = useUserState();
  if (!data?.defaultHarness) return null;
  return { harness: data.defaultHarness as HarnessId, model: data.defaultModel ?? null };
}

/** Make a selection the default, the way Settings, Models does. */
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
