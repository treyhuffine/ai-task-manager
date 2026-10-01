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
 * (`HARNESS_REGISTRY[id].agentexProviderId`).
 */
export const CHEAP_MODEL_CANDIDATES: Record<string, readonly string[]> = {
  claude: ['haiku'],
  codex: ['gpt-6-luna', 'gpt-5.6-luna'],
};
