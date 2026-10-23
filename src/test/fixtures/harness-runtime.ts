/** Synthetic runtime facts for policy tests. Never native harness qualification. */
import type { AuthReport } from '@agentex/agent';
import { harnessDefinition, type HarnessId } from '@/lib/harness/registry';
import type { HarnessRuntimeView } from '@/lib/harness/runtime';

export function fakeHarnessRuntime(harness: HarnessId): HarnessRuntimeView {
  const definition = harnessDefinition(harness);
  return { harness, binary: { status: 'supported', command: 'fixture-only', version: 'fixture', protocolProfile: null },
    capabilities: Object.fromEntries(Object.entries(definition.maximumCapabilities).map(([name, supported]) => [name, { supported, status: supported ? 'supported' : 'unsupported', ...(!supported ? { reason: `${definition.name} does not support ${name}.` } : {}) }])) as HarnessRuntimeView['capabilities'] };
}
export function fakeHarnessAuth(harness: HarnessId, present = true): AuthReport {
  return { providerType: harness, binary: { installed: true, version: 'fixture' }, source: 'cli', options: [{ method: 'subscription', source: { kind: 'cli', command: 'fixture-only' }, present }] };
}
