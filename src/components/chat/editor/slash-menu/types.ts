/**
 * Re-exports the descriptor shape from agentex. The slash menu UI is
 * provider-agnostic — it consumes whatever agentex hands it.
 */
export type {
  SkillCommandDescriptor,
  SkillCommandSource,
  SkillCommandExecution,
  RuntimeCommandInventory,
} from '@agentex/agent'
