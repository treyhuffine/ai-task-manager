/**
 * The cheap/fast model alias each harness exposes. agentex's providers don't
 * curate model lists; CLIs accept short aliases like `haiku` or model ids like
 * `gpt-5.4-mini`. We use the smallest one that's good enough for low-stakes
 * work (the verification ping, title generation).
 *
 * Keyed by harness id, which is also the agentex provider id
 * (`HARNESS_REGISTRY[id].agentexProviderId`).
 */
export const CHEAPEST_MODEL: Record<string, string> = {
  claude: 'haiku',
  codex: 'gpt-5.4-mini',
};
