import { createHash } from 'node:crypto';
import {
  customModelOption,
  explicitAgentSelection,
  modelsForProvider,
  type ExplicitAgentSelection,
  type AgentModelsResponse,
  type ModelOption,
  type ProviderId,
} from '@/lib/agent-options';
import { getAgentHarnessSettings } from '@/lib/db/queries';
import { EFFORT_LEVELS, type EffortLevel } from '@/db/types';
import { getHarnessRuntime, runtimeContextForHarness } from '@/lib/agents/runtime';
import { HARNESS_REGISTRY } from '@/lib/agents/registry';
import type { ProviderRuntimeContext, UpstreamProvider } from '@agentex/agent';

const CACHE_TTL_MS = 15 * 60 * 1000;
const FAILURE_TTL_MS = 30 * 1000;

interface CachedModels {
  expiresAt: number;
  value: AgentModelsResponse;
}

const cache = new Map<string, CachedModels>();

interface ModelDiscoveryContext {
  key: string;
  runtime: ProviderRuntimeContext;
  upstream: UpstreamProvider[] | null;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

/**
 * Produce a one-way cache identity. Runtime environment values can include a
 * Cursor API key, so raw context must never be stored in the key or logged.
 */
export function agentModelCacheFingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

async function modelDiscoveryContext(
  providerId: ProviderId,
  options: { cwd?: string; refresh?: boolean },
): Promise<ModelDiscoveryContext> {
  const { getProvider } = await import('@agentex/agent');
  const provider = getProvider(providerId);
  const [runtime, report] = await Promise.all([
    runtimeContextForHarness(providerId, options),
    getHarnessRuntime(providerId, options),
  ]);
  let upstream: UpstreamProvider[] | null = null;
  if (providerId === 'opencode'
    && report.binary.status === 'supported'
    && provider.upstreamProviders) {
    try {
      // This small live read makes external OpenCode credential changes part
      // of the identity instead of relying only on route-level invalidation.
      upstream = await provider.upstreamProviders.list(runtime);
    } catch {
      // Discovery below remains fail closed. A catalog obtained without a
      // trustworthy connection report marks provider-owned models unavailable.
    }
  }
  const apiKeyVar = HARNESS_REGISTRY[providerId].apiKeyVar;
  const fingerprint = agentModelCacheFingerprint({
    runtime,
    ambientCredential: apiKeyVar ? process.env[apiKeyVar] ?? null : null,
    binary: {
      status: report.binary.status,
      command: report.binary.command,
      version: report.binary.version,
      protocolProfile: report.binary.protocolProfile,
    },
    upstream: upstream?.map((entry) => ({
      id: entry.id,
      name: entry.name,
      connected: entry.connected,
      authMethodIds: [...entry.authMethodIds].sort(),
    })).sort((left, right) => left.id.localeCompare(right.id)) ?? null,
  });
  return {
    key: JSON.stringify([providerId, options.cwd ?? '', fingerprint]),
    runtime,
    upstream,
  };
}

function modelLabel(displayName: string): string {
  return displayName.replace(/^GPT-/i, '').replaceAll('-', ' ');
}

function parseEffortLevel(value: unknown): EffortLevel | null {
  return typeof value === 'string' && EFFORT_LEVELS.includes(value as EffortLevel)
    ? value as EffortLevel
    : null;
}

function parseSupportedEfforts(value: unknown): EffortLevel[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<EffortLevel>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const effort = parseEffortLevel((item as { effort?: unknown }).effort);
    if (effort) seen.add(effort);
  }
  return [...seen];
}

function providerModelOption(
  providerId: ProviderId,
  model: import('@agentex/agent').ProviderModel,
): ModelOption {
  const supportedEfforts = (model.supportedEfforts ?? [])
    .filter((value): value is EffortLevel => EFFORT_LEVELS.includes(value as EffortLevel));
  const defaultEffort = parseEffortLevel(model.defaultEffort);
  return {
    id: model.id,
    label: providerId === 'codex' ? modelLabel(model.name) : model.name,
    ...(model.description ? { hint: model.description } : {}),
    ...(model.provider ? { provider: model.provider } : {}),
    ...(model.providerName ? { providerName: model.providerName } : {}),
    ...(model.variants ? { variants: model.variants } : {}),
    ...(supportedEfforts.length > 0 ? { supportedEfforts } : {}),
    ...(defaultEffort ? { defaultEffort } : {}),
    ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxOutputTokens !== undefined ? { maxOutputTokens: model.maxOutputTokens } : {}),
    ...(model.inputCostPerMillion !== undefined ? { inputCostPerMillion: model.inputCostPerMillion } : {}),
    ...(model.outputCostPerMillion !== undefined ? { outputCostPerMillion: model.outputCostPerMillion } : {}),
    ...(model.supportsImages !== undefined ? { supportsImages: model.supportsImages } : {}),
    ...(model.supportsTools !== undefined ? { supportsTools: model.supportsTools } : {}),
    availability: 'available',
  };
}

export function applyOpenCodeProviderAvailability(
  models: ModelOption[],
  upstream: UpstreamProvider[],
): ModelOption[] {
  const connected = new Set(upstream.filter((entry) => entry.connected).map((entry) => entry.id));
  return models.map((model) => model.provider && !connected.has(model.provider)
    ? {
      ...model,
      availability: 'unavailable' as const,
      availabilityReason: `${model.providerName ?? model.provider} is not connected`,
    }
    : model);
}

async function discoverModels(
  providerId: ProviderId,
  context: ModelDiscoveryContext,
  options: { cwd?: string; refresh?: boolean } = {},
): Promise<AgentModelsResponse> {
  const { getProvider } = await import('@agentex/agent');
  const provider = getProvider(providerId);
  if (provider.listModels) {
    try {
      const models = await provider.listModels({
        ...context.runtime,
        cacheTtlMs: options.refresh ? 0 : CACHE_TTL_MS,
      });
      if (models.length > 0) {
        let mapped = models.map((model) => providerModelOption(providerId, model));
        if (providerId === 'opencode' && provider.upstreamProviders) {
          mapped = applyOpenCodeProviderAvailability(mapped, context.upstream ?? []);
        }
        return {
          source: 'provider',
          models: mapped,
        };
      }
    } catch {
      // Fall through to the bundled catalog. Discovery throws rather than
      // returning an empty list when a provider's probe mechanism is broken,
      // so this catch is the intended landing spot for that case.
    }
  }

  return { models: modelsForProvider(providerId), source: 'config' };
}

export async function getAgentModels(
  providerId: ProviderId,
  options: { cwd?: string; refresh?: boolean } = {},
): Promise<AgentModelsResponse> {
  const context = await modelDiscoveryContext(providerId, options);
  const cached = cache.get(context.key);
  if (!options.refresh && cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const value = await discoverModels(providerId, context, options);
    cache.set(context.key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (error) {
    console.warn(`[agent-models] ${providerId} discovery failed, using config fallback`, error);
    const value: AgentModelsResponse = {
      models: modelsForProvider(providerId),
      source: 'config',
    };
    cache.set(context.key, { value, expiresAt: Date.now() + FAILURE_TTL_MS });
    return value;
  }
}

/**
 * User-pinned exact model ids for one provider, as catalog entries.
 *
 * Read straight from settings rather than through the discovery cache: a pin
 * is a local decision, so it must be usable the moment it is saved and must
 * survive a provider being offline. A pin that collides with a real catalog id
 * keeps the discovered metadata (see the merge order in `getAgentModelCatalog`).
 */
export function customModelCatalog(providerId: ProviderId): ModelOption[] {
  return (getAgentHarnessSettings(providerId)?.customModels ?? []).map(customModelOption);
}

/**
 * Catalog used for server-side validation. Keep bundled models and pinned ids
 * alongside live discovery so stable aliases such as `opus` remain valid when
 * a provider API returns only versioned model ids, and so a hand-typed id is
 * accepted by every validator instead of only the one that saved it.
 */
export async function getAgentModelCatalog(
  providerId: ProviderId,
  options: { cwd?: string; refresh?: boolean } = {},
): Promise<ModelOption[]> {
  const discovered = (await getAgentModels(providerId, options)).models
    .filter((model) => model.availability !== 'unavailable');
  const byId = new Map<string, ModelOption>();
  for (const model of [...discovered, ...modelsForProvider(providerId), ...customModelCatalog(providerId)]) {
    if (!byId.has(model.id)) byId.set(model.id, model);
  }
  return [...byId.values()];
}

/** Resolve and validate the explicit tuple used when a server creates a chat. */
export async function resolveAgentSelection(
  providerId: ProviderId,
  preferred: {
    model?: string | null;
    variant?: string | null;
    effort?: EffortLevel | null;
  } = {},
  options: { cwd?: string; refresh?: boolean; repairInvalidModel?: boolean } = {},
): Promise<ExplicitAgentSelection> {
  const catalog = await getAgentModelCatalog(providerId, {
    cwd: options.cwd,
    refresh: options.refresh,
  });
  if (catalog.length === 0) {
    throw new Error(`No models are available for ${providerId}. Connect the harness and refresh its catalog.`);
  }
  const requestedModel = preferred.model?.trim();
  if (requestedModel && !catalog.some((model) => model.id === requestedModel)) {
    if (!options.repairInvalidModel) {
      throw new Error(`Model ${requestedModel} is unavailable for ${providerId}`);
    }
    preferred = { ...preferred, model: null, variant: null };
  }
  const selection = explicitAgentSelection(
    providerId,
    preferred,
    catalog,
  );
  if (preferred.variant && selection.variant !== preferred.variant) {
    throw new Error(`Variant ${preferred.variant} is unavailable for model ${selection.model}`);
  }
  return selection;
}

export function clearAgentModelCache(providerId?: ProviderId): void {
  if (!providerId) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`[\"${providerId}\"`)) cache.delete(key);
  }
}
