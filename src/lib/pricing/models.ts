/**
 * Lightweight cost computation. We pull token counts from
 * `@agentex/agent`'s `result` event and convert via a JSON pricing
 * table. Prefer the SDK's `costUsd` field when present (Anthropic
 * provides it); fall back to this table when the provider doesn't.
 *
 * Prices are in **cents per million tokens** so the JSON stays
 * integer-friendly. `costUsd` from the SDK is already in dollars.
 */

import pricingJson from './models.json';

interface ModelPricing {
  /** Cents per million tokens for fresh (uncached) input. */
  input: number;
  /** Cents per million tokens for cached input reads (cheaper). */
  cached: number;
  /** Cents per million tokens for writing into the cache (more expensive than fresh). */
  cacheCreation: number;
  /** Cents per million tokens for output. */
  output: number;
}

const TABLE = pricingJson as Record<string, ModelPricing>;

const ZERO_PRICING: ModelPricing = { input: 0, cached: 0, cacheCreation: 0, output: 0 };

/** Models we've already warned about; suppresses log spam in a hot session. */
const warnedUnknownModels = new Set<string>();

function warnUnknownModelOnce(model: string): void {
  if (warnedUnknownModels.has(model)) return;
  warnedUnknownModels.add(model);
  console.warn(
    `[pricing] no entry for model "${model}" — cost will fall back to the provider's reported costUsd or zero. Add a row to src/lib/pricing/models.json to enable accurate fallback.`,
  );
}

/** Test seam. */
export function _resetPricingWarnings(): void {
  warnedUnknownModels.clear();
}

export interface ModelUsage {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
}

/**
 * Lookup the per-million-token price for a model. Tolerates a bare
 * model name ("claude-sonnet-4-6"), the canonical provider-prefixed
 * form ("anthropic/claude-sonnet-4-6"), and versioned ids carrying a
 * `-YYYYMMDD` date suffix Anthropic emits at release
 * ("claude-opus-4-7-20260415"). Unknown models return all-zero pricing
 * and emit a warn-once log so a brand-new model isn't silently free.
 */
export function pricingFor(model: string | null | undefined): ModelPricing {
  if (!model) return ZERO_PRICING;
  const candidates = pricingCandidates(model);
  for (const id of candidates) {
    if (TABLE[id]) return TABLE[id];
  }
  warnUnknownModelOnce(model);
  return ZERO_PRICING;
}

/**
 * Generate fallback lookup keys for a model id: the literal id, the
 * provider-prefixed forms, the same with a trailing `-YYYYMMDD` version
 * suffix stripped, then a tier fallback that drops a GPT minor version
 * (`gpt-5.4` → `gpt-5`). Order is most-specific first so the table can
 * supply a version-pinned price when one exists, but a new minor version
 * still resolves to its tier price without a per-version row. (Codex
 * sends `gpt-5.4` / `gpt-5.4-mini` and reports no `costUsd`, so the table
 * is the *only* cost source for it — this bridge keeps it from $0.)
 */
function pricingCandidates(model: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  const prefixed = (id: string) => {
    if (id.includes('/')) return [id];
    return [id, `anthropic/${id}`, `openai/${id}`];
  };
  for (const id of prefixed(model)) add(id);
  const stripped = model.replace(/-\d{8}$/, '');
  if (stripped !== model) {
    for (const id of prefixed(stripped)) add(id);
  }
  // GPT tier fallback: `gpt-5.4` → `gpt-5`, `gpt-5.4-mini` → `gpt-5-mini`.
  // Anchorless so it works pre- or post-prefix; never matches Claude ids.
  const tier = stripped.replace(/(gpt-?\d+)\.\d+/i, '$1');
  if (tier !== stripped) {
    for (const id of prefixed(tier)) add(id);
  }
  return out;
}

/**
 * Compute the dollar cost of a single turn from a usage shape. Cents-per-
 * million-tokens × tokens / 1_000_000 / 100 (cents → dollars).
 */
export function costForUsage(model: string | null | undefined, usage: ModelUsage): number {
  const p = pricingFor(model);
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const cached = usage.cachedInputTokens ?? 0;
  const creation = usage.cacheCreationInputTokens ?? 0;
  const cents =
    (input * p.input + output * p.output + cached * p.cached + creation * p.cacheCreation) /
    1_000_000;
  return cents / 100;
}

/**
 * Convenience: pull tokens + model + cost from an `@agentex/agent`
 * result event. Tolerates partial / missing shapes — the executor
 * upstream is mid-flux and we'd rather record zero than blow up.
 */
export function captureFromResultEvent(event: unknown): {
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
} {
  if (!event || typeof event !== 'object') {
    return {
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUsd: 0,
    };
  }
  const e = event as {
    model?: string;
    usage?: ModelUsage & Record<string, unknown>;
    costUsd?: number;
  };
  const model = e.model ?? null;
  const usage = e.usage ?? {};
  const inputTokens = Number(usage.inputTokens ?? 0) || 0;
  const outputTokens = Number(usage.outputTokens ?? 0) || 0;
  const cachedInputTokens = Number(usage.cachedInputTokens ?? 0) || 0;
  const cacheCreationInputTokens = Number(usage.cacheCreationInputTokens ?? 0) || 0;
  // Prefer the SDK's reported costUsd; fall back to our pricing table.
  const reported = typeof e.costUsd === 'number' && Number.isFinite(e.costUsd) ? e.costUsd : null;
  const costUsd =
    reported != null
      ? reported
      : costForUsage(model, { inputTokens, outputTokens, cachedInputTokens, cacheCreationInputTokens });
  return { model, inputTokens, outputTokens, cachedInputTokens, cacheCreationInputTokens, costUsd };
}
