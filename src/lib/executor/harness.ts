/**
 * Shared knobs that the executor and adjacent code (verify, label
 * derivation, etc.) all need to agree on.
 *
 * Two concerns:
 *
 *   1. Mapping our descriptive `agents.harness` strings (`claude_code`,
 *      `codex`) to the keys agentex's provider registry actually uses
 *      (`claude`, `codex`). Done at the boundary so the DB stays
 *      readable and the registry stays canonical.
 *
 *   2. The cheap/fast model alias each provider exposes. agentex's
 *      providers don't curate model lists; CLIs accept short aliases
 *      like `haiku` or model id strings like `gpt-5.4-mini`. We use the
 *      smallest one that's good enough for low-stakes work
 *      (verification ping, title generation, etc.).
 */

export function mapHarnessToProvider(harness: string): string {
  switch (harness) {
    case 'claude_code': return 'claude';
    case 'codex': return 'codex';
    default: return harness;
  }
}

/**
 * Cheap-model alias per agentex provider type. Used by /api/agent/verify
 * for the "are you wired up correctly" round-trip and by
 * `deriveAndSetSessionLabel` for first-message title summarization.
 */
export const CHEAPEST_MODEL: Record<string, string> = {
  claude: 'haiku',
  codex: 'gpt-5.4-mini',
};
