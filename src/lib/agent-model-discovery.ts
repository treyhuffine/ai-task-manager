import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  modelsForProvider,
  type AgentModelsResponse,
  type ModelOption,
  type ProviderId,
} from '@/lib/agent-options';

const execFileAsync = promisify(execFile);
const CACHE_TTL_MS = 15 * 60 * 1000;
const FAILURE_TTL_MS = 30 * 1000;

interface CodexCatalogModel {
  slug?: unknown;
  display_name?: unknown;
  description?: unknown;
  visibility?: unknown;
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
    models.push({
      id: entry.slug,
      label: modelLabel(entry.display_name),
      ...(typeof entry.description === 'string' && entry.description
        ? { hint: entry.description.replace(/[.]$/, '') }
        : {}),
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
