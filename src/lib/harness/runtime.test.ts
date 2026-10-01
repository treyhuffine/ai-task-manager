import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderRuntimeReport } from '@agentex/agent';
import { intersectHarnessCapability, runtimeContextForHarness } from './runtime';
import { HARNESS_REGISTRY, KNOWN_HARNESS_IDS } from './registry';

vi.mock('./credentials', () => ({ openCursorApiKey: async () => null }));
afterEach(() => vi.unstubAllEnvs());

describe('harness executable overrides', () => {
  it.each(KNOWN_HARNESS_IDS)('uses the %s override without losing other config', async (harness) => {
    const variable = HARNESS_REGISTRY[harness].commandEnv;
    vi.stubEnv(variable, `  /custom/${harness}  `);
    expect(await runtimeContextForHarness(harness, { config: { model: 'chosen-model' } })).toMatchObject({
      config: { command: `/custom/${harness}`, model: 'chosen-model' },
    });
    vi.stubEnv(variable, '  ');
    expect(await runtimeContextForHarness(harness, { config: { command: '/configured/tool' } })).toMatchObject({
      config: { command: '/configured/tool' },
    });
  });
});

const supportedBinary: ProviderRuntimeReport['binary'] = {
  status: 'supported',
  command: 'agent',
  version: '1.0.0',
  protocolProfile: 'current',
};

describe('effective harness capabilities', () => {
  it('intersects app maximums, provider declarations, and runtime probes', () => {
    expect(intersectHarnessCapability(false, true, undefined, supportedBinary).supported).toBe(false);
    expect(intersectHarnessCapability(true, false, undefined, supportedBinary).supported).toBe(false);
    expect(intersectHarnessCapability(true, true, undefined, supportedBinary)).toEqual({
      supported: true,
      status: 'supported',
    });
  });

  it('preserves an installed binary upgrade requirement from the runtime probe', () => {
    expect(intersectHarnessCapability(true, true, {
      supported: false,
      status: 'upgrade_required',
      reason: 'Install a newer Cursor CLI',
    }, supportedBinary)).toEqual({
      supported: false,
      status: 'upgrade_required',
      reason: 'Install a newer Cursor CLI',
    });
  });

  it('does not advertise unprobed support when the binary is missing', () => {
    expect(intersectHarnessCapability(true, true, undefined, {
      status: 'missing',
      command: null,
      version: null,
      protocolProfile: null,
      reason: 'Cursor is not installed',
    })).toEqual({
      supported: false,
      status: 'missing',
      reason: 'Cursor is not installed',
    });
  });

  it('fails closed when the overall runtime is degraded', () => {
    expect(intersectHarnessCapability(true, true, {
      supported: true,
      status: 'supported',
    }, {
      status: 'degraded',
      command: 'opencode',
      version: '1.0.0',
      protocolProfile: 'incomplete',
      reason: 'Required permission endpoints are missing',
    })).toEqual({
      supported: false,
      status: 'degraded',
      reason: 'Required permission endpoints are missing',
    });
  });
});
