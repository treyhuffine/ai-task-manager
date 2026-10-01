import type { HarnessId } from '@/lib/harness/registry';

/**
 * The cheap/fast model alias each harness exposes. agentex's providers don't
 * curate model lists; CLIs accept short aliases like `haiku` or model ids like
 * `gpt-5.4-mini`. We use the smallest one that's good enough for low-stakes
 * work (the verification ping, title generation).
 *
 * Keyed by harness id, which is also the agentex provider id
 * (`HARNESS_REGISTRY[id].agentexProviderId`). A harness left out runs those
 * calls on its CLI's own default model:
 *
 * - cursor and opencode: the catalog depends on the account and its providers.
 * - antigravity: there is no stable alias. Slugs carry a version and a
 *   thinking level (`gemini-3.8-flash-medium`) and Google retires them, and a
 *   pinned slug that stopped existing would fail every fast-tier background
 *   call (deck, stream urgency, capture), not just degrade it. Chat titles
 *   use the chat's own model, so they don't need one either.
 */
export const CHEAPEST_MODEL: Partial<Record<HarnessId, string>> = {
  claude: 'haiku',
  codex: 'gpt-5.4-mini',
};
