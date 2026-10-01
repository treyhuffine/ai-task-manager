import { isHarnessEnabled, type HarnessId } from '@/lib/harness/registry';

/**
 * The cheap/fast model alias each harness exposes. agentex's providers don't
 * curate model lists; CLIs accept short aliases like `haiku` or model ids like
 * `gpt-5.4-mini`. We use the smallest one that's good enough for low-stakes
 * work (the verification ping, title generation).
 *
 * Keyed by harness id, which is also the agentex provider id
 * (`HARNESS_REGISTRY[id].agentexProviderId`). A null alias leaves those
 * calls on the CLI's own default model:
 *
 * - cursor and opencode: the catalog depends on the account and its providers.
 * - antigravity: there is no stable alias. Slugs carry a version and a
 *   thinking level (`gemini-3.8-flash-medium`) and Google retires them, and a
 *   pinned slug that stopped existing would fail every fast-tier call.
 *   Background calls currently fail closed for this harness, as below.
 */
export const CHEAPEST_MODEL: Record<HarnessId, string | null> = {
  claude: 'haiku',
  codex: 'gpt-5.4-mini',
  cursor: null,
  opencode: null,
  antigravity: null,
};


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
