import { describe, expect, it } from 'vitest';
import {
  agentModelCacheFingerprint,
  applyOpenCodeProviderAvailability,
  parseCodexModelCatalog,
} from './agent-model-discovery';

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

describe('parseCodexModelCatalog', () => {
  it('returns visible CLI models in catalog order with picker labels', () => {
    const result = parseCodexModelCatalog(JSON.stringify({
      models: [
        {
          slug: 'gpt-5.5',
          display_name: 'GPT-5.5',
          description: 'Frontier model.',
          visibility: 'list',
        },
        {
          slug: 'gpt-5.6-sol',
          display_name: 'GPT-5.6-Sol',
          description: 'Latest frontier agentic coding model.',
          visibility: 'list',
          supported_reasoning_levels: [
            { effort: 'low', description: 'Fast responses' },
            { effort: 'max', description: 'Maximum reasoning' },
            { effort: 'ultra', description: 'Automatic delegation' },
            { effort: 'future-value', description: 'Unknown to this app' },
          ],
          default_reasoning_level: 'low',
        },
        {
          slug: 'hidden-model',
          display_name: 'Hidden-Model',
          visibility: 'hide',
        },
      ],
    }));

    expect(result).toEqual([
      { id: 'gpt-5.5', label: '5.5', hint: 'Frontier model' },
      {
        id: 'gpt-5.6-sol',
        label: '5.6 Sol',
        hint: 'Latest frontier agentic coding model',
        supportedEfforts: ['low', 'max', 'ultra'],
        defaultEffort: 'low',
      },
    ]);
  });

  it('rejects an empty visible catalog so callers use the fallback', () => {
    expect(() => parseCodexModelCatalog('{"models":[]}')).toThrow('no visible models');
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
