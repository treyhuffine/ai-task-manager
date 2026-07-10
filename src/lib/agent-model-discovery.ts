import { execFile } from 'node:child_process';
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

const cache = new Map<ProviderId, CachedModels>();

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

async function discoverModels(providerId: ProviderId): Promise<AgentModelsResponse> {
  const { getProvider } = await import('@agentex/agent');
  const provider = getProvider(providerId);
  if (provider.listModels) {
    try {
      const models = await provider.listModels({ cacheTtlMs: CACHE_TTL_MS });
      if (models.length > 0) {
        return {
          source: 'provider',
          models: models.map((model) => ({
            id: model.id,
            label: providerId === 'codex' ? modelLabel(model.name) : model.name,
          })),
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

export async function getAgentModels(providerId: ProviderId): Promise<AgentModelsResponse> {
  const cached = cache.get(providerId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const value = await discoverModels(providerId);
    cache.set(providerId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (error) {
    console.warn(`[agent-models] ${providerId} discovery failed, using config fallback`, error);
    const value: AgentModelsResponse = {
      models: modelsForProvider(providerId),
      source: 'config',
    };
    cache.set(providerId, { value, expiresAt: Date.now() + FAILURE_TTL_MS });
    return value;
  }
}

/**
 * Catalog used for server-side validation. Keep bundled models alongside live
 * discovery so stable aliases such as `opus` remain valid when a provider API
 * returns only versioned model ids.
 */
export async function getAgentModelCatalog(providerId: ProviderId): Promise<ModelOption[]> {
  const discovered = (await getAgentModels(providerId)).models;
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
    effort?: EffortLevel | null;
  } = {},
): Promise<ExplicitAgentSelection> {
  return explicitAgentSelection(
    providerId,
    preferred,
    await getAgentModelCatalog(providerId),
  );
}
