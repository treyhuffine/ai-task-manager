import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import {
  explicitAgentSelection,
  modelsForProvider,
  type ExplicitAgentSelection,
  type AgentModelsResponse,
  type ModelOption,
  type ProviderId,
} from '@/lib/agent-options';
import { EFFORT_LEVELS, type EffortLevel } from '@/db/types';
import { getHarnessRuntime, runtimeContextForHarness } from '@/lib/agents/runtime';
import { HARNESS_REGISTRY } from '@/lib/agents/registry';
import type { ProviderRuntimeContext, UpstreamProvider } from '@agentex/agent';

const execFileAsync = promisify(execFile);
const CACHE_TTL_MS = 15 * 60 * 1000;
const FAILURE_TTL_MS = 30 * 1000;

interface CodexCatalogModel {
  slug?: unknown;
  display_name?: unknown;
  description?: unknown;
  visibility?: unknown;
  supported_reasoning_levels?: unknown;
  default_reasoning_level?: unknown;
}

interface CodexCatalog {
  models?: unknown;
}

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

export function parseCodexModelCatalog(raw: string): ModelOption[] {
  const parsed = JSON.parse(raw) as CodexCatalog;
  if (!Array.isArray(parsed.models)) throw new Error('Codex model catalog has no models array');

  const seen = new Set<string>();
  const models: ModelOption[] = [];
  for (const entry of parsed.models as CodexCatalogModel[]) {
    if (entry.visibility !== 'list') continue;
    if (typeof entry.slug !== 'string' || typeof entry.display_name !== 'string') continue;
    if (seen.has(entry.slug)) continue;
    seen.add(entry.slug);
    const supportedEfforts = parseSupportedEfforts(entry.supported_reasoning_levels);
    const defaultEffort = parseEffortLevel(entry.default_reasoning_level);
    models.push({
      id: entry.slug,
      label: modelLabel(entry.display_name),
      ...(typeof entry.description === 'string' && entry.description
        ? { hint: entry.description.replace(/[.]$/, '') }
        : {}),
      ...(supportedEfforts.length > 0 ? { supportedEfforts } : {}),
      ...(defaultEffort ? { defaultEffort } : {}),
    });
  }

  if (models.length === 0) throw new Error('Codex model catalog has no visible models');
  return models;
}

async function discoverCodexModels(): Promise<ModelOption[]> {
  const command = process.env.CODEX_COMMAND || 'codex';
  const { stdout } = await execFileAsync(command, ['debug', 'models'], {
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return parseCodexModelCatalog(stdout);
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
      // Continue to the provider-specific discovery path or config fallback.
    }
  }

  if (providerId === 'codex') {
    const models = await discoverCodexModels();
    return { models, source: 'cli' };
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
 * Catalog used for server-side validation. Keep bundled models alongside live
 * discovery so stable aliases such as `opus` remain valid when a provider API
 * returns only versioned model ids.
 */
export async function getAgentModelCatalog(
  providerId: ProviderId,
  options: { cwd?: string; refresh?: boolean } = {},
): Promise<ModelOption[]> {
  const discovered = (await getAgentModels(providerId, options)).models
    .filter((model) => model.availability !== 'unavailable');
  const byId = new Map<string, ModelOption>();
  for (const model of [...discovered, ...modelsForProvider(providerId)]) {
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
