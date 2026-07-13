import {
  getProvider,
  type AuthReport,
  type CapabilityStatus,
  type ProviderCapabilities,
  type ProviderConfig,
  type ProviderRuntimeContext,
  type ProviderRuntimeReport,
} from '@agentex/agent';
import { HARNESS_REGISTRY, type HarnessCapabilities, type HarnessId } from './registry';
import { openCursorApiKey } from './credentials';
import { registerAgentRuntimeSecret } from './redaction';

const CACHE_TTL_MS = 60_000;

export interface HarnessCapabilityView {
  supported: boolean;
  status: CapabilityStatus;
  reason?: string;
}

export interface HarnessRuntimeView {
  harness: HarnessId;
  binary: ProviderRuntimeReport['binary'];
  capabilities: Record<keyof HarnessCapabilities, HarnessCapabilityView>;
}

interface CachedRuntime {
  expiresAt: number;
  value: HarnessRuntimeView;
}

const cache = new Map<string, CachedRuntime>();

const COMMAND_ENV: Record<HarnessId, string> = {
  claude: 'CLAUDE_COMMAND',
  codex: 'CODEX_COMMAND',
  cursor: 'CURSOR_COMMAND',
  opencode: 'OPENCODE_COMMAND',
};

const CAPABILITY_KEYS: Partial<Record<keyof HarnessCapabilities, keyof ProviderCapabilities>> = {
  sessions: 'sessions',
  resume: 'resume',
  durableCatchUp: 'durableHistory',
  modelDiscovery: 'modelDiscovery',
  upstreamProviderDisconnect: 'upstreamProviderDisconnect',
  modelVariants: 'modelVariants',
  permissionRequests: 'permissionRequests',
  questionRequests: 'questionRequests',
  planMode: 'planMode',
  modes: 'modes',
  mcp: 'mcp',
  strictMcpIsolation: 'strictMcpIsolation',
  concurrentSend: 'concurrentSend',
  cancelQueuedMessage: 'cancelQueuedMessage',
  stopTask: 'stopTask',
  sessionModelChange: 'sessionModelChange',
  sessionVariantChange: 'sessionVariantChange',
  sessionEffortChange: 'sessionEffortChange',
  sessionModeChange: 'sessionModeChange',
};

function commandFor(harness: HarnessId): string | undefined {
  const value = process.env[COMMAND_ENV[harness]]?.trim();
  return value || undefined;
}

export async function runtimeContextForHarness(
  harness: HarnessId,
  options: { cwd?: string; refresh?: boolean; config?: ProviderConfig } = {},
): Promise<ProviderRuntimeContext> {
  const command = commandFor(harness);
  const env: Record<string, string> = {};
  if (harness === 'cursor') {
    const apiKey = await openCursorApiKey();
    if (apiKey) {
      registerAgentRuntimeSecret(apiKey, 'cursor-api-key');
      env.CURSOR_API_KEY = apiKey;
    }
  }
  return {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
    ...((command || options.config) ? { config: { ...options.config, ...(command ? { command } : {}) } } : {}),
    ...(options.refresh ? { refresh: true } : {}),
  };
}

export async function resolveHarnessAuth(
  harness: HarnessId,
  options: { cwd?: string; fresh?: boolean } = {},
): Promise<AuthReport> {
  const provider = getProvider(HARNESS_REGISTRY[harness].agentexProviderId);
  const ctx = await runtimeContextForHarness(harness, { cwd: options.cwd });
  return provider.resolveAuth({
    env: ctx.env,
    command: ctx.config?.command,
    fresh: options.fresh,
  });
}

function missingReport(reason: string): ProviderRuntimeReport {
  return {
    binary: { status: 'missing', command: null, version: null, protocolProfile: null, reason },
    capabilities: {},
  };
}

async function providerRuntimeReport(
  harness: HarnessId,
  ctx: ProviderRuntimeContext,
): Promise<ProviderRuntimeReport> {
  const provider = getProvider(HARNESS_REGISTRY[harness].agentexProviderId);
  if (provider.probeCapabilities) return provider.probeCapabilities(ctx);

  const auth = await provider.resolveAuth({
    env: ctx.env,
    command: ctx.config?.command,
    fresh: ctx.refresh,
  });
  if (!auth.binary.installed) return missingReport(auth.binary.error ?? `${HARNESS_REGISTRY[harness].name} is not installed`);
  return {
    binary: {
      status: 'supported',
      command: auth.binary.resolvedPath ?? ctx.config?.command ?? null,
      version: auth.binary.version ?? null,
      protocolProfile: null,
    },
    capabilities: {},
  };
}

export function intersectHarnessCapability(
  maximum: boolean,
  providerValue: boolean,
  runtime: ProviderRuntimeReport['capabilities'][keyof ProviderCapabilities] | undefined,
  binary: ProviderRuntimeReport['binary'],
): HarnessCapabilityView {
  if (!maximum || !providerValue) {
    return { supported: false, status: 'missing', reason: 'This harness does not support this capability' };
  }
  if (binary.status !== 'supported') {
    return {
      supported: false,
      status: binary.status,
      ...((runtime?.reason ?? binary.reason) ? { reason: runtime?.reason ?? binary.reason } : {}),
    };
  }
  if (runtime) return runtime;
  return { supported: true, status: 'supported' };
}

export async function getHarnessRuntime(
  harness: HarnessId,
  options: { cwd?: string; refresh?: boolean } = {},
): Promise<HarnessRuntimeView> {
  const command = commandFor(harness) ?? '';
  const key = JSON.stringify([harness, options.cwd ?? '', command]);
  const cached = cache.get(key);
  if (!options.refresh && cached && cached.expiresAt > Date.now()) return cached.value;

  const provider = getProvider(HARNESS_REGISTRY[harness].agentexProviderId);
  const ctx = await runtimeContextForHarness(harness, options);
  let report: ProviderRuntimeReport;
  try {
    report = await providerRuntimeReport(harness, ctx);
  } catch (error) {
    report = missingReport(error instanceof Error ? error.message : String(error));
  }

  const maximum = HARNESS_REGISTRY[harness].maximumCapabilities;
  const capabilities = {} as Record<keyof HarnessCapabilities, HarnessCapabilityView>;
  for (const key of Object.keys(maximum) as Array<keyof HarnessCapabilities>) {
    if (key === 'reasoningEffort') {
      const supported = maximum[key] && (harness === 'claude' || harness === 'codex');
      capabilities[key] = intersectHarnessCapability(supported, supported, undefined, report.binary);
      continue;
    }
    if (key === 'upstreamProviderSetup') {
      const supported = maximum[key] && Boolean(provider.upstreamProviders);
      capabilities[key] = intersectHarnessCapability(supported, supported, undefined, report.binary);
      continue;
    }
    const providerKey = CAPABILITY_KEYS[key];
    const providerValue = providerKey ? provider.capabilities[providerKey] === true : maximum[key];
    capabilities[key] = intersectHarnessCapability(
      maximum[key],
      providerValue,
      providerKey ? report.capabilities[providerKey] : undefined,
      report.binary,
    );
  }

  const value = { harness, binary: report.binary, capabilities };
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export function clearHarnessRuntimeCache(harness?: HarnessId): void {
  if (!harness) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`[\"${harness}\"`)) cache.delete(key);
  }
}
