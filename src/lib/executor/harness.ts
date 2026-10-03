import { isHarnessEnabled, type HarnessId } from '@/lib/harness/registry';

/**
 * Cheap models for low-stakes background work (the verification ping, titles,
 * handoff summaries, urgency checks), most preferred first. agentex's
 * providers don't curate model lists. CLIs accept short aliases like `haiku`
 * or exact ids like `gpt-6-luna`.
 *
 * Claude's is a tier alias that never goes stale. Codex's are pinned versions,
 * which OpenAI retires (`gpt-5.4-mini` stopped working with ChatGPT accounts)
 * and only lists to a CLI new enough to run them. So Codex keeps more than one,
 * and `cheapModelFor` (../harness/model-discovery) sends the first one the
 * installed catalog offers, never a dead id.
 *
 * Keyed by harness id, which is also the agentex provider id
 * (`HARNESS_REGISTRY[id].agentexProviderId`). Every harness needs an explicit
 * entry. An empty list leaves those calls on the CLI's own default model:
 *
 * - cursor and opencode: the catalog depends on the account and its providers.
 * - antigravity: there is no stable alias. Slugs carry a version and a
 *   thinking level (`gemini-3.8-flash-medium`) and Google retires them, and a
 *   pinned slug that stopped existing would fail every fast-tier call.
 *   Background calls currently fail closed for this harness, as below.
 */
export const CHEAP_MODEL_CANDIDATES: Record<string, readonly string[]> = {
  claude: ['haiku'],
  codex: ['gpt-6-luna', 'gpt-5.6-luna'],
  cursor: [],
  opencode: [],
  antigravity: [],
} satisfies Record<HarnessId, readonly string[]>;


/** Each new harness needs an explicit background-execution assessment. */
const BACKGROUND_UNAVAILABLE_REASON: Record<HarnessId, string | null> = {
  codex: null,
  claude: null,
  cursor: null,
  opencode: null,
  // agy honors skipPermissions but ignores strictMcpConfig and tool filters.
  // Its plan mode is prompt behavior, not a replacement for those restrictions.
  antigravity: 'Antigravity background calls are unavailable because its CLI cannot enforce '
    + 'the required tool restrictions and MCP isolation. Choose another default harness for background AI.',
};

/** Why an unattended background call cannot launch this harness. */
export function backgroundHarnessUnavailableReason(harness: HarnessId): string | null {
  if (!isHarnessEnabled(harness)) return `${harness} is disabled by the rollout configuration`;
  return BACKGROUND_UNAVAILABLE_REASON[harness];
}
