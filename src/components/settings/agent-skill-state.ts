import type { RouterOutputs } from '@/lib/trpc/router';

/**
 * Ri's user-level skills as Settings reads them: the saved choice (first-run
 * setup's, or the last click) and what's actually in `~/.claude/skills` and
 * `~/.agents/skills` (`src/lib/server/operations/harness/skills/global.ts`).
 */
export type AgentSkillStatus = RouterOutputs['harness']['skillsGlobalGet'];

/**
 * - `on`: installed, so coding tools in every project have them.
 * - `declined`: uninstalled on purpose, so nothing asks about it again.
 * - `blocked`: another skill holds the name, and installing leaves it alone.
 * - `off`: not there yet: never chosen, or a link was deleted by hand.
 * - `app-only`: the desktop app keeps them inside its own folder.
 */
export type AgentSkillState = 'on' | 'off' | 'declined' | 'blocked' | 'app-only';

export function agentSkillState(status: AgentSkillStatus): AgentSkillState {
  if (status.appOnly) return 'app-only';
  if (status.installed) return 'on';
  if (status.configured && !status.enabled) return 'declined';
  if (status.conflicts.length > 0) return 'blocked';
  return 'off';
}
