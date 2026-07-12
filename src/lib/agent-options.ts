/**
 * Per-harness model + effort options surfaced in the composer dropdowns.
 *
 * This is the immediate UI fallback. Providers with model discovery replace
 * their list at runtime. Keeping a complete fallback means settings still work
 * when a CLI is missing, offline, or too old to expose model discovery.
 *
 * Effort levels mirror Claude's `--effort` flag (extended thinking
 * budget). Codex doesn't accept `--effort` in agentex — the dropdown
 * hides on Codex sessions to avoid promising behavior we can't deliver.
 */

import type { EffortLevel } from '@/db/types';
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

export type AgentModelSource = 'provider' | 'cli' | 'config';

export interface AgentModelsResponse {
  models: ModelOption[];
  source: AgentModelSource;
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

export function effortOptionsForModel(
  harness: string | null,
  model: ModelOption | null,
): EffortOption[] {
  if (harness === 'claude_code') {
    return EFFORT_OPTIONS.filter((option) => option.id !== 'ultra');
  }
  if (harness !== 'codex') return [];

  // Custom/default Codex models may not have catalog metadata. Keep that
  // fallback conservative so the UI never offers max or ultra to a model that
  // could reject them. Selecting a catalog model unlocks its exact levels.
  const supported = new Set<EffortLevel>(
    model?.supportedEfforts?.length
      ? model.supportedEfforts
      : ['low', 'medium', 'high', 'xhigh'],
  );
  return EFFORT_OPTIONS.filter((option) => supported.has(option.id));
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
 * while explicitly rejecting the other provider's namespace. Unknown custom
 * ids are rejected because the UI only supports catalog-backed selections.
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
  if (modelId && modelBelongsToProvider(providerId, modelId, catalog)) {
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
  // Without model capability metadata, an explicit Codex value may have
  // already been validated against live discovery by the server. Preserve it
  // here so the synchronous DB creation guard does not downgrade that tuple.
  if (harness === 'codex' && preferred && !model.supportedEfforts?.length) {
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
  effort: EffortLevel;
}

/** Resolve the atomic provider + model + effort tuple stored on a chat. */
export function explicitAgentSelection(
  providerId: ProviderId,
  preferred: {
    model?: string | null;
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
    effort: explicitEffortForModel(harness, model, preferred.effort),
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
  return harness === 'claude_code' || harness === 'codex';
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
