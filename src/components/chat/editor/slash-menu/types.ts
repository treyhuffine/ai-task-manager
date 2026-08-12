/**
 * Re-exports the descriptor shape from agentex. The slash menu UI is
 * provider-agnostic — it consumes whatever agentex hands it.
 */
import type { SkillCommandDescriptor } from '@agentex/agent'

export type {
  SkillCommandDescriptor,
  SkillCommandSource,
  SkillCommandExecution,
  RuntimeCommandInventory,
} from '@agentex/agent'

/**
 * A descriptor plus the app's own usage signal. `frecency` is the decayed
 * use-count from the `skill_usage` table, computed server-side in
 * `GET /api/sessions/:id/slash-commands`. Absent or 0 means never used —
 * ranking still works, it just has one fewer tiebreak.
 */
export interface SlashCommand extends SkillCommandDescriptor {
  frecency?: number
}
