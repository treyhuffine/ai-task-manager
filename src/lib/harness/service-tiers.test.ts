import { describe, expect, it } from 'vitest';
import { assertServiceTier, serviceTierForModel, serviceTierOptions } from './service-tiers';
import type { ModelOption } from './options';

const model: ModelOption = {
  id: 'gpt-test', label: 'Test model', defaultServiceTier: 'priority',
  serviceTiers: [
    { id: 'default', name: 'Standard', availability: 'available' },
    { id: 'priority', name: 'Fast', availability: 'unknown' },
    { id: 'ultrafast', name: 'Ultrafast', availability: 'unavailable', reason: 'Disabled by the provider' },
    { id: 'future-speed', name: 'Future speed', availability: 'unknown' },
  ],
};

describe('model speed choices', () => {
  it('offers only provider metadata, retaining unknown entitlement and future tiers', () => {
    expect(serviceTierOptions({ id: 'opus', label: 'Opus' })).toEqual([]);
    expect(serviceTierOptions(model)).toMatchObject([
      { id: 'default', label: 'Normal', disabled: false },
      { id: 'priority', label: 'Fast', disabled: false },
      { id: 'ultrafast', disabled: true, hint: 'Disabled by the provider' },
      { id: 'future-speed', label: 'Future speed', disabled: false },
    ]);
  });

  it('never chooses a paid catalog default without an explicit preference', () => {
    expect(serviceTierForModel(model)).toBe('default');
    expect(serviceTierForModel(model, 'fast')).toBe('priority');
    expect(serviceTierForModel(model, 'future-speed')).toBe('future-speed');
    expect(serviceTierForModel(model, 'ultrafast')).toBe('default');
    expect(serviceTierForModel(null, 'priority')).toBeNull();
  });

  it('rejects unsupported or explicitly disabled selections without inventing entitlement', () => {
    expect(() => assertServiceTier(model, 'priority')).not.toThrow();
    expect(() => assertServiceTier(model, 'fast')).not.toThrow();
    expect(() => assertServiceTier(model, 'ultrafast')).toThrow('Disabled by the provider');
    expect(() => assertServiceTier(model, 'unknown')).toThrow('does not offer');
    expect(() => assertServiceTier(null, 'default')).toThrow('does not offer');
    expect(() => assertServiceTier(null, null)).not.toThrow();
  });
});
