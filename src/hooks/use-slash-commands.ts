/**
 * Fetches the merged slash-command list for a chat session: agentex's
 * local skill discovery reconciled against the provider's runtime
 * inventory (captured from `system/init` by the executor adapter).
 *
 * Only commands that are both `userInvocable` and `available` come back.
 * Refetches on focus so newly-installed skills surface without a hard
 * refresh, but the staleTime keeps idle composer keystrokes from
 * thrashing the API.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { SkillCommandDescriptor, SkillCommandDiagnostic } from '@agentex/agent';

export interface SlashCommandsResponse {
  commands: SkillCommandDescriptor[];
  diagnostics: SkillCommandDiagnostic[];
  inventorySource: 'provider-init' | 'configured' | 'none';
}

export function useSlashCommands(sessionId: string | null | undefined) {
  return useQuery({
    queryKey: ['sessions', sessionId, 'slash-commands'],
    queryFn: () => api.get<SlashCommandsResponse>(`/sessions/${sessionId}/slash-commands`),
    enabled: !!sessionId,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}
