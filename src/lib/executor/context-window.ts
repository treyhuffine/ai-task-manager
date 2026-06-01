/**
 * Model display label + context-window cap, derived from the model id the
 * CLI reports back in its `system` StreamEvent (e.g. `claude-opus-4-8`,
 * `gpt-5.4-mini`).
 *
 * Two halves, on purpose:
 *
 *  - The **label** is computed generically by `prettifyModelId` — any
 *    `claude-<family>-<maj>-<min>` becomes "Family Maj.Min". A brand-new
 *    Opus version renders correctly with no code change. This is what lets
 *    us send the `opus`/`sonnet`/`haiku` aliases (see ../agent-options) and
 *    still show the precise resolved version once a turn has run.
 *
 *  - The **context-window cap** is the one thing the CLI *doesn't* report,
 *    so it needs a lookup. We key it on coarse family+version ranges that
 *    only change when a new context size actually ships (4.7 → 4.8 is still
 *    1M → nothing to touch). An unrecognized model just hides the "% used"
 *    indicator rather than showing a wrong number.
 */

export interface ModelInfo {
  /** Display label, e.g. "Opus 4.8". */
  label: string;
  /** Hard cap in tokens for the model's context window. 0 = unknown (hide %). */
  contextWindow: number;
}

/**
 * Context-window caps, matched most-specific first. Version ranges are
 * deliberately open-ended (e.g. Opus 4.7+) so future minor bumps within
 * the same context generation need no edit; only a genuinely new window
 * (1M → 2M) does. Anything unmatched falls through to a 0 cap.
 */
const CONTEXT_CAPS: Array<{ test: RegExp; contextWindow: number }> = [
  // Anthropic — 1M-context generation: Opus ≥4.7, Sonnet ≥4.6.
  { test: /opus-?4[._-](?:[7-9]|\d\d)/i, contextWindow: 1_000_000 },
  { test: /opus/i, contextWindow: 200_000 },
  { test: /sonnet-?4[._-](?:[6-9]|\d\d)/i, contextWindow: 1_000_000 },
  { test: /sonnet/i, contextWindow: 200_000 },
  { test: /haiku/i, contextWindow: 200_000 },
  // OpenAI / Codex
  { test: /gpt-?5/i, contextWindow: 400_000 },
];

const FAMILY_LABEL: Record<string, string> = {
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
};

/**
 * Turn a raw provider model id into a friendly label:
 *   claude-opus-4-8            → "Opus 4.8"
 *   claude-haiku-4-5-20251001  → "Haiku 4.5"   (trailing date dropped)
 *   opus                       → "Opus"        (bare alias, pre-dispatch)
 *   gpt-5.4-mini               → "GPT-5.4 mini"
 * Falls back to the raw id when nothing matches.
 */
export function prettifyModelId(id: string): string {
  const anthropic = /claude-(opus|sonnet|haiku)-(\d+)-(\d+)/i.exec(id);
  if (anthropic) {
    const [, family, major, minor] = anthropic;
    return `${FAMILY_LABEL[family.toLowerCase()]} ${major}.${minor}`;
  }

  const bareFamily = /^(opus|sonnet|haiku)$/i.exec(id);
  if (bareFamily) return FAMILY_LABEL[bareFamily[1].toLowerCase()];

  const gpt = /gpt-?(\d+(?:\.\d+)?)(?:-(mini|nano))?/i.exec(id);
  if (gpt) return `GPT-${gpt[1]}${gpt[2] ? ` ${gpt[2].toLowerCase()}` : ''}`;

  return id;
}

export function resolveModelInfo(modelId: string | null | undefined): ModelInfo | null {
  if (!modelId) return null;
  let contextWindow = 0;
  for (const row of CONTEXT_CAPS) {
    if (row.test.test(modelId)) {
      contextWindow = row.contextWindow;
      break;
    }
  }
  return { label: prettifyModelId(modelId), contextWindow };
}
