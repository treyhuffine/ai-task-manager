import { getProvider, type ProviderRuntimeContext, type UpstreamProviderManager } from '@agentex/agent';
import { getAppRoot } from '@/lib/config/paths';
import { runtimeContextForHarness } from './runtime';

export function openCodeProviderManager(): UpstreamProviderManager {
  const manager = getProvider('opencode').upstreamProviders;
  if (!manager) throw new Error('Installed Agentex does not expose OpenCode provider management');
  return manager;
}

export function openCodeRuntimeContext(refresh = false): Promise<ProviderRuntimeContext> {
  return runtimeContextForHarness('opencode', { cwd: getAppRoot(), refresh });
}

export function safeOpenCodeErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code.slice(0, 100);
  }
  return 'opencode_provider_operation_failed';
}

export function isAlreadyDisconnected(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:404|not found|already.*(?:absent|disconnected)|no credential)/i.test(message);
}

