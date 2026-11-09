import { trpcClient } from '@/lib/trpc/client';
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

import type { HarnessId } from '@/lib/harness/registry';
import { SKILLS_KEY } from './use-skills';
import type { SlashCommand } from '@/components/chat/editor/slash-menu/types';
import type { SkillCommandDiagnostic } from '@agentex/agent';
import { useQuery } from '@tanstack/react-query';

export interface SlashCommandsResponse {
  /** Descriptors carrying the decayed `frecency` the route joins on. */
  commands: SlashCommand[];
  diagnostics: SkillCommandDiagnostic[];
  inventorySource: 'provider-init' | 'configured' | 'none';
}

/** Cache key, exported so the send path can invalidate after an invocation. */
export function slashCommandsKey(sessionId: string) {
  return ['sessions', sessionId, 'slash-commands'] as const;
}

export function useSlashCommands(sessionId: string | null | undefined) {
  return useQuery({
    queryKey: slashCommandsKey(sessionId ?? ''),
    queryFn: () => trpcClient.sessions.slashCommandsGet.query({params: {id: sessionId ?? ''}}),
    enabled: !!sessionId,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}

/** New chat has no session yet. Discover using its selected agent and harness. */
export function useLaunchSlashCommands(workspaceId: string | null, harness: HarnessId, enabled: boolean) {
  return useQuery({
    queryKey: [...SKILLS_KEY, 'commands', workspaceId, harness],
    queryFn: () => trpcClient.skills.commands.query({ query: { workspaceId: workspaceId ?? undefined, harness } }),
    enabled,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}
