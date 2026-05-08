/**
 * Per-model context window caps (tokens). Used by the composer's "X%
 * used" indicator. We keep this tiny and explicit rather than reaching
 * for a remote registry — the values change rarely, and an unknown
 * model just hides the percentage instead of showing wrong info.
 *
 * Match against `system` event `model` field from agentex StreamEvents.
 * Claude reports things like `claude-opus-4-7`, `claude-sonnet-4-6`.
 * Codex reports `gpt-5.4-mini` / `gpt-5.4`. Match prefixes liberally.
 */

export interface ModelInfo {
  /** Display label shown in the composer (e.g. "Opus 4.7"). */
  label: string;
  /** Hard cap in tokens for the model's context window. */
  contextWindow: number;
}

const TABLE: Array<{ test: RegExp; info: ModelInfo }> = [
  // Anthropic
  { test: /opus-?4[._-]7/i, info: { label: 'Opus 4.7', contextWindow: 1_000_000 } },
  { test: /opus-?4[._-]6/i, info: { label: 'Opus 4.6', contextWindow: 200_000 } },
  { test: /opus/i, info: { label: 'Opus', contextWindow: 200_000 } },
  { test: /sonnet-?4[._-]6/i, info: { label: 'Sonnet 4.6', contextWindow: 1_000_000 } },
  { test: /sonnet/i, info: { label: 'Sonnet', contextWindow: 200_000 } },
  { test: /haiku-?4[._-]5/i, info: { label: 'Haiku 4.5', contextWindow: 200_000 } },
  { test: /haiku/i, info: { label: 'Haiku', contextWindow: 200_000 } },
  // OpenAI / Codex
  { test: /gpt-?5[._-]4-?mini/i, info: { label: 'GPT-5.4 mini', contextWindow: 400_000 } },
  { test: /gpt-?5[._-]4/i, info: { label: 'GPT-5.4', contextWindow: 400_000 } },
];

export function resolveModelInfo(modelId: string | null | undefined): ModelInfo | null {
  if (!modelId) return null;
  for (const row of TABLE) {
    if (row.test.test(modelId)) return row.info;
  }
  // Fallback: show the raw id with no context cap so the percentage hides.
  return { label: modelId, contextWindow: 0 };
}
