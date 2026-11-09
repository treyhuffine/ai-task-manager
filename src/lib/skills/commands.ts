import {
  discoverSkillCommands,
  reconcileSkillCommands,
  type RuntimeCommandInventory,
} from '@agentex/agent';
import { getSkillUsageScores } from '@/lib/db/queries';
import { resolveSkillDirsForSession, type ResolveSkillsOptions } from '@/lib/executor/skills';
import type { HarnessId } from '@/lib/harness/registry';

/** The same installed skills before launch and in a chat, with runtime availability when known. */
export async function chatSkillCommands(input: {
  cwd: string;
  harness: HarnessId;
  inventory?: RuntimeCommandInventory | null;
  skillPlan?: ResolveSkillsOptions;
}) {
  const { commands, diagnostics } = await discoverSkillCommands({
    cwd: input.cwd,
    skillDirs: resolveSkillDirsForSession(input.cwd, input.skillPlan),
    includeInstalled: 'all',
    runtime: input.harness,
  });
  const reconciled = reconcileSkillCommands({
    discovered: commands,
    inventory: input.inventory,
    provider: input.harness,
  });
  const usage = getSkillUsageScores();
  return {
    commands: reconciled
      .filter(cmd => cmd.userInvocable !== false && cmd.available !== false)
      .map(cmd => {
        const frecency = usage.get(cmd.name.toLowerCase());
        return frecency ? { ...cmd, frecency } : cmd;
      }),
    diagnostics,
    inventorySource: input.inventory?.source ?? 'none',
  };
}
