import { describe, expect, it } from 'vitest';
import {
  agentModelCacheFingerprint,
  applyOpenCodeProviderAvailability,
  withBundledFallback,
} from './model-discovery';
import { bundledModelIds } from './options';

describe('agent model cache identity', () => {
  it('does not expose credentials and changes with runtime or provider state', () => {
    const secret = 'cursor-key-never-store-in-cache-key';
    const base = {
      runtime: { env: { CURSOR_API_KEY: secret }, config: { command: 'cursor-agent' } },
      binary: { version: '1.0.0', protocolProfile: 'cursor-stream-json-v1' },
      upstream: [{ id: 'xai', connected: false }],
    };
    const fingerprint = agentModelCacheFingerprint(base);

    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint).not.toContain(secret);
    expect(agentModelCacheFingerprint({ ...base, binary: { ...base.binary, version: '1.0.1' } }))
      .not.toBe(fingerprint);
    expect(agentModelCacheFingerprint({ ...base, upstream: [{ id: 'xai', connected: true }] }))
      .not.toBe(fingerprint);
  });
});

describe('OpenCode provider availability', () => {
  it('marks models from disconnected upstream providers unavailable', () => {
    const models = applyOpenCodeProviderAvailability([
      { id: 'anthropic/claude', label: 'Claude', provider: 'anthropic', providerName: 'Anthropic' },
      { id: 'xai/grok', label: 'Grok', provider: 'xai', providerName: 'xAI' },
    ], [
      { id: 'anthropic', name: 'Anthropic', connected: true, authMethodIds: [] },
      { id: 'xai', name: 'xAI', connected: false, authMethodIds: [] },
    ]);

    expect(models[0]!.availability).not.toBe('unavailable');
    expect(models[1]).toMatchObject({
      availability: 'unavailable',
      availabilityReason: 'xAI is not connected',
    });
  });
});

/**
 * OpenAI lists a Codex model only to CLI versions that can run it, and an
 * older CLI that is asked for one anyway gets "not supported when using Codex
 * with a ChatGPT account". So what the installed CLI lists decides which
 * bundled ids are runnable here.
 */
describe('bundled models against live discovery', () => {
  // `codex debug models` from CLI 0.153.4, which predates the GPT-6 Sol/Luna release.
  const olderCli = ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5']
    .map((id) => ({ id, label: id, availability: 'available' as const }));

  it('marks a bundled model the installed CLI does not list unavailable, saying why', () => {
    const merged = withBundledFallback('codex', { source: 'provider', models: olderCli });
    expect(merged.slice(0, olderCli.length)).toEqual(olderCli);
    const byId = new Map(merged.map((model) => [model.id, model]));
    for (const id of ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna']) {
      expect(byId.get(id)).toMatchObject({
        availability: 'unavailable',
        availabilityReason: 'The installed Codex does not offer this model. Update Codex to use it.',
      });
    }
    expect(byId.get('gpt-6-astra')?.availability).toBe('available');
    // Every bundled id is still present exactly once, so settings can show it.
    expect(merged.map((model) => model.id).sort()).toEqual(
      [...new Set([...olderCli.map((model) => model.id), ...bundledModelIds('codex')])].sort(),
    );
  });

  it('marks nothing unavailable once the CLI lists the whole bundle', () => {
    const newerCli = bundledModelIds('codex').map((id) => ({ id, label: id }));
    const merged = withBundledFallback('codex', { source: 'provider', models: newerCli });
    expect(merged).toEqual(newerCli);
  });

  it('keeps the bundle usable as is when there was no live answer', () => {
    const merged = withBundledFallback('codex', { source: 'config', models: [] });
    expect(merged.map((model) => model.id)).toEqual(bundledModelIds('codex'));
    expect(merged.every((model) => model.availability !== 'unavailable')).toBe(true);
  });

  it('keeps every Claude alias valid even when a probe misses one', () => {
    // Claude discovery only probes Ri's own alias list. A probe that comes
    // back empty for `opus` must not block every Opus chat.
    const probed = ['sonnet', 'haiku', 'fable'].map((id) => ({ id, label: id }));
    const merged = withBundledFallback('claude', { source: 'provider', models: probed });
    expect(merged.map((model) => model.id).sort()).toEqual(['fable', 'haiku', 'opus', 'sonnet']);
    expect(merged.every((model) => model.availability !== 'unavailable')).toBe(true);
  });
});
