/**
 * Per-harness model + effort options surfaced in the composer dropdowns.
 *
 * This is the immediate UI fallback. Providers with model discovery replace
 * their list at runtime. Keeping a complete fallback means settings still work
 * when a CLI is missing, offline, or too old to expose model discovery.
 *
 * Effort levels mirror provider reasoning controls. Claude receives the
 * selected value through `--effort`. Codex receives it through Agentex's
 * per-turn app-server request.
 */

import type { EffortLevel } from '@/db/types';
import { prettifyModelId } from '@/lib/executor/context-window';
import {
  HARNESS_IDS,
  HARNESS_REGISTRY,
  harnessDefinition,
  harnessIdForAgentRecord,
  type AgentHarness,
  type HarnessId,
} from '@/lib/agents/registry';

export type { AgentHarness } from '@/lib/agents/registry';

export interface ModelOption {
  /** Provider id passed to agentex via `config.model`. */
  id: string;
  /** Display label in the composer dropdown. */
  label: string;
  /** Optional secondary line in the dropdown (e.g. "1M context"). */
  hint?: string;
  /** Reasoning effort values advertised by this exact model. */
  supportedEfforts?: EffortLevel[];
  /** Provider-recommended effort when no per-session override is selected. */
  defaultEffort?: EffortLevel;
  provider?: string;
  providerName?: string;
  variants?: Array<{
    id: string;
    name: string;
    description?: string;
    isDefault?: boolean;
    disabled?: boolean;
  }>;
  contextWindow?: number;
  maxOutputTokens?: number;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  supportsImages?: boolean;
  supportsTools?: boolean;
  availability?: 'available' | 'unavailable';
  availabilityReason?: string;
  enabled?: boolean;
  /** Typed in by the user (see `customModelOption`) rather than discovered. */
  custom?: boolean;
}

/**
 * Exact-id pins the user typed in. Providers keep shipping models faster than
 * any catalog read can see them — and Claude's bundled entries are tier
 * aliases on purpose (`opus` = "the best current Opus") — so pegging a build
 * (`claude-opus-4-8`) is the one thing picking from a list cannot express.
 *
 * The id travels to the provider verbatim. Everything else about it is
 * cosmetic: the label is a best-effort prettify so the composer chip stays
 * short, and the raw id is always shown beside it.
 */
export function customModelOption(id: string): ModelOption {
  return {
    id,
    label: prettifyModelId(id),
    hint: id,
    custom: true,
    availability: 'available',
  };
}

/**
 * Accepted shape for a typed model id: what providers actually use in model
 * slugs (`anthropic/claude-opus-4-8`, `gpt-5.4-mini`, `qwen3:32b`). Anything
 * with whitespace or shell-flavored punctuation is a paste accident rather
 * than a model, so it is rejected at the input instead of failing later at the
 * provider boundary. Returns null when the value is unusable.
 */
export function normalizeCustomModelId(raw: string | null | undefined): string | null {
  const id = raw?.trim() ?? '';
  if (!id || id.length > 160) return null;
  return /^[A-Za-z0-9][A-Za-z0-9._:@/+-]*$/.test(id) ? id : null;
}

/**
 * Claude models use the CLI's tier *aliases* (`opus`/`sonnet`/`haiku`/`fable`)
 * rather than pinned version ids. The alias resolves to whatever the
 * installed Claude binary currently ships as that tier, so a model
 * upgrade (Opus 4.7 → 4.8 → …) requires zero changes here — the picker
 * always means "the best current Opus". The precise version is surfaced
 * after a turn from the model the CLI reports back (see
 * `resolveModelInfo` in ./executor/context-window) — the dropdown label
 * stays generic, the live chip upgrades to "Opus 4.8" once known.
 *
 * Codex model ids come from `codex debug models` at runtime. The entries below
 * mirror the current CLI catalog and are only the failure fallback.
 */
export const MODEL_OPTIONS: Record<AgentHarness, ModelOption[]> = {
  claude_code: [
    { id: 'opus', label: 'Opus', hint: 'latest · top quality' },
    { id: 'sonnet', label: 'Sonnet', hint: 'latest · balanced' },
    { id: 'haiku', label: 'Haiku', hint: 'latest · fast + cheap' },
    { id: 'fable', label: 'Fable', hint: 'latest' },
  ],
  codex: [
    { id: 'gpt-5.5', label: '5.5', hint: 'Frontier model for complex coding, research, and real-world work' },
    { id: 'gpt-5.6-sol', label: '5.6 Sol', hint: 'Latest frontier agentic coding model' },
    { id: 'gpt-5.6-terra', label: '5.6 Terra', hint: 'Balanced agentic coding model for everyday work' },
    { id: 'gpt-5.6-luna', label: '5.6 Luna', hint: 'Fast and affordable agentic coding model' },
    { id: 'gpt-5.4', label: '5.4', hint: 'Strong model for everyday coding' },
    { id: 'gpt-5.4-mini', label: '5.4 Mini', hint: 'Small, fast, and cost-efficient model for simpler coding tasks' },
    { id: 'gpt-5.3-codex-spark', label: '5.3 Codex Spark', hint: 'Ultra-fast coding model' },
  ],
  cursor: [],
  opencode: [],
};

/** Where a catalog came from: the harness itself, or Flow's bundled fallback. */
export type AgentModelSource = 'provider' | 'config';

export interface AgentModelsResponse {
  models: ModelOption[];
  source: AgentModelSource;
  enabledModelIds?: string[];
  /** Exact ids the user pinned by hand for this provider. */
  customModelIds?: string[];
  defaultModel?: string | null;
  defaultVariant?: string | null;
  defaultEffort?: EffortLevel | null;
  catalogRefreshedAt?: string | null;
}

export interface EffortOption {
  id: EffortLevel;
  /** Full label shown inside the dropdown row. */
  label: string;
  /** Short label shown on the composer chip. */
  shortLabel: string;
  hint: string;
}

// Provider reasoning-effort values. Individual Codex models expose a subset
// through their live model catalog, while Claude currently uses the shared
// list without model-specific discovery.
export const EFFORT_OPTIONS: EffortOption[] = [
  { id: 'low', label: 'Low', shortLabel: 'low', hint: 'Minimal thinking, fastest' },
  { id: 'medium', label: 'Medium', shortLabel: 'med', hint: 'Balanced default' },
  { id: 'high', label: 'High', shortLabel: 'high', hint: 'More thinking budget' },
  { id: 'xhigh', label: 'Extra high', shortLabel: 'xhigh', hint: 'Heavy thinking budget' },
  { id: 'max', label: 'Max', shortLabel: 'max', hint: 'Maximum thinking budget' },
  {
    id: 'ultra',
    label: 'Ultra',
    shortLabel: 'ultra',
    hint: 'Maximum reasoning with automatic task delegation',
  },
];

const FALLBACK_EFFORTS: Partial<Record<HarnessId, readonly EffortLevel[]>> = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  codex: ['low', 'medium', 'high', 'xhigh'],
};

/**
 * Provider vocabulary for a shared effort id. Both CLIs expose the same top
 * rung, but Claude names it "ultracode" and Codex names it "ultra". The
 * dropdown borrows whichever word the selected provider uses rather than
 * inventing a third one the user would then have to translate.
 */
const EFFORT_LABEL_OVERRIDES: Partial<
  Record<HarnessId, Partial<Record<EffortLevel, Partial<EffortOption>>>>
> = {
  claude: {
    ultra: {
      label: 'Ultracode',
      shortLabel: 'ultracode',
      hint: 'Extra high plus standing workflow orchestration',
    },
  },
};

const PRESERVE_EXTERNALLY_VALIDATED_EFFORT = new Set<HarnessId>(['codex']);

export function effortOptionsForModel(
  harness: string | null,
  model: ModelOption | null,
): EffortOption[] {
  let providerId: HarnessId;
  try {
    providerId = providerIdForHarness(harness);
  } catch {
    return [];
  }
  if (!HARNESS_REGISTRY[providerId].maximumCapabilities.reasoningEffort) return [];

  // A live model catalog wins. Static fallback ranges remain provider data,
  // while visibility is controlled by the registry capability above.
  const supported = new Set<EffortLevel>(
    model?.supportedEfforts?.length
      ? model.supportedEfforts
      : FALLBACK_EFFORTS[providerId] ?? [],
  );
  const overrides = EFFORT_LABEL_OVERRIDES[providerId];
  return EFFORT_OPTIONS
    .filter((option) => supported.has(option.id))
    .map((option) => (overrides?.[option.id] ? { ...option, ...overrides[option.id] } : option));
}

/** Explicit fallback used when a provider does not advertise a preference. */
export const DEFAULT_AGENT_EFFORT: EffortLevel = 'medium';

/** Map an agent row's harness vocabulary back to the persisted provider id. */
export function providerIdForHarness(harness: string | null | undefined): ProviderId {
  if (!harness) throw new Error('Agent harness is required');
  return harnessIdForAgentRecord(harness);
}

/**
 * Return whether a model id can safely be sent to a provider.
 *
 * The catalog is authoritative when the model is present. The prefix checks
 * cover discovered models that are newer than this app's bundled fallback,
 * while explicitly rejecting the other provider's namespace. Ids the user
 * pinned by hand pass through the catalog arm — the server merges them in
 * (see `getAgentModelCatalog`), so they are catalog members here, not a
 * separate exemption.
 */
export function modelBelongsToProvider(
  providerId: ProviderId,
  modelId: string,
  models: readonly ModelOption[] = modelsForProvider(providerId),
): boolean {
  if (models.some((model) => model.id === modelId)) return true;
  if (providerId === 'claude') {
    return modelId.startsWith('claude-') || ['opus', 'sonnet', 'haiku', 'fable'].includes(modelId);
  }
  if (providerId === 'codex') return /^(?:gpt-|o\d(?:-|$)|codex(?:-|$))/i.test(modelId);
  return models.some((model) => model.id === modelId);
}

/**
 * Resolve a model to a concrete option for one provider. Invalid, empty, and
 * cross-provider values fall back to that provider's first configured model.
 */
export function explicitModelForProvider(
  providerId: ProviderId,
  preferred: string | null | undefined,
  models: readonly ModelOption[] = modelsForProvider(providerId),
): ModelOption {
  const catalog = models.length > 0 ? models : modelsForProvider(providerId);
  const modelId = preferred?.trim();
  // Cursor and OpenCode have no bundled catalog. This branch preserves a
  // tuple already validated by async `resolveAgentSelection`, or one that the
  // executor's live-catalog preflight will reject before provider launch.
  // It is deliberately not standalone validation for user input.
  const externallyValidatedDynamicModel =
    modelId && catalog.length === 0 && (providerId === 'cursor' || providerId === 'opencode');
  if (modelId && (modelBelongsToProvider(providerId, modelId, catalog) || externallyValidatedDynamicModel)) {
    return catalog.find((model) => model.id === modelId) ?? { id: modelId, label: modelId };
  }

  return catalog[0] ?? {
    id: defaultModelFor(providerId),
    label: defaultModelFor(providerId),
  };
}

/**
 * Resolve reasoning effort to a concrete provider-supported value. A model's
 * advertised default wins when the preferred value is absent or unsupported.
 */
export function explicitEffortForModel(
  harness: string,
  model: ModelOption,
  preferred: EffortLevel | null | undefined,
): EffortLevel {
  const options = effortOptionsForModel(harness, model);
  const supported = new Set(options.map((option) => option.id));
  let providerId: HarnessId | null = null;
  try {
    providerId = providerIdForHarness(harness);
  } catch {
    // Unknown harnesses have no supported effort values.
  }
  // Some dynamic catalogs validate effort before reaching the synchronous DB
  // boundary but do not carry model metadata into that boundary.
  if (providerId
    && PRESERVE_EXTERNALLY_VALIDATED_EFFORT.has(providerId)
    && preferred
    && !model.supportedEfforts?.length) {
    return preferred;
  }
  if (preferred && supported.has(preferred)) return preferred;
  if (model.defaultEffort && supported.has(model.defaultEffort)) return model.defaultEffort;
  if (supported.has(DEFAULT_AGENT_EFFORT)) return DEFAULT_AGENT_EFFORT;
  return options[0]?.id ?? DEFAULT_AGENT_EFFORT;
}

export interface ExplicitAgentSelection {
  providerId: ProviderId;
  harness: AgentHarness;
  model: string;
  variant: string | null;
  effort: EffortLevel | null;
}

export function explicitVariantForModel(
  model: ModelOption,
  preferred: string | null | undefined,
): string | null {
  const variants = model.variants?.filter((variant) => !variant.disabled) ?? [];
  // Dynamic-only providers are validated against their live catalog before
  // reaching this synchronous boundary. The executor repeats validation before
  // launch, which also protects scheduled and internal creation paths.
  if (preferred && variants.length === 0) return preferred;
  if (preferred && variants.some((variant) => variant.id === preferred)) return preferred;
  return variants.find((variant) => variant.isDefault)?.id ?? null;
}

/** Resolve the atomic provider + model + effort tuple stored on a chat. */
export function explicitAgentSelection(
  providerId: ProviderId,
  preferred: {
    model?: string | null;
    variant?: string | null;
    effort?: EffortLevel | null;
  } = {},
  models: readonly ModelOption[] = modelsForProvider(providerId),
): ExplicitAgentSelection {
  const harness = providerHarnessKey(providerId);
  const model = explicitModelForProvider(providerId, preferred.model, models);
  return {
    providerId,
    harness,
    model: model.id,
    variant: explicitVariantForModel(model, preferred.variant),
    effort: harnessSupportsEffort(harness)
      ? explicitEffortForModel(harness, model, preferred.effort)
      : null,
  };
}

/**
 * Resolve a provider model id to its option metadata. Returns null when
 * the id isn't in the catalog (e.g. user typed a custom one or running
 * an old session pinned to a removed model).
 */
export function findModelOption(harness: string, modelId: string | null): ModelOption | null {
  if (!modelId) return null;
  const list = MODEL_OPTIONS[harness as AgentHarness];
  if (!list) return null;
  return list.find((m) => m.id === modelId) ?? null;
}

export function harnessSupportsEffort(harness: string): boolean {
  try {
    return HARNESS_REGISTRY[providerIdForHarness(harness)].maximumCapabilities.reasoningEffort;
  } catch {
    return false;
  }
}

// ─── Providers ────────────────────────────────────────────────
// The selectable agent providers, in the `user_state.defaultAgentHarness`
// vocabulary ('claude' | 'codex'). Distinct from the internal
// `agents.harness` / MODEL_OPTIONS vocabulary ('claude_code' | 'codex') —
// `providerHarnessKey` bridges the two. Single source of truth for the
// onboarding step, the settings selector, and the connection check.

/** Persistable provider id — matches `user_state.defaultAgentHarness`. */
export type ProviderId = HarnessId;

export interface ProviderOption {
  id: ProviderId;
  /** Key into MODEL_OPTIONS / agents.harness. */
  harnessKey: AgentHarness;
  name: string;
  blurb: string;
  /** CLI login command shown when the provider isn't connected. */
  loginCmd: string;
  /** Env var that, if set, bills the API directly (metered). */
  apiKeyVar: string;
  installHint: string;
}

export const PROVIDERS: ProviderOption[] = [
  ...HARNESS_IDS.map((id) => {
    const harness = HARNESS_REGISTRY[id];
    return {
      id,
      harnessKey: harness.agentRecordHarness,
      name: harness.name,
      blurb: harness.description,
      loginCmd: harness.loginCommand ?? '',
      apiKeyVar: harness.apiKeyVar ?? '',
      installHint: harness.installHint,
    };
  }),
];

/** `defaultAgentHarness` vocab → MODEL_OPTIONS / harness vocab. */
export function providerHarnessKey(id: ProviderId): AgentHarness {
  return harnessDefinition(id).agentRecordHarness;
}

export function findProvider(id: string | null | undefined): ProviderOption | null {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

export function modelsForProvider(id: ProviderId): ModelOption[] {
  return MODEL_OPTIONS[providerHarnessKey(id)] ?? [];
}

/** The provider's flagship (first listed) model id — the sensible default pick. */
export function defaultModelFor(id: ProviderId): string {
  return modelsForProvider(id)[0]?.id ?? '';
}
