import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetPricingWarnings, costForUsage, pricingFor } from './models';

describe('pricingFor', () => {
  beforeEach(() => {
    _resetPricingWarnings();
  });

  it('looks up a canonical provider-prefixed id', () => {
    expect(pricingFor('anthropic/claude-sonnet-4-6').input).toBeGreaterThan(0);
  });

  it('falls back to provider prefix for a bare model id', () => {
    expect(pricingFor('claude-sonnet-4-6').input).toBeGreaterThan(0);
  });

  it('strips a trailing -YYYYMMDD version suffix before fallback', () => {
    const dated = pricingFor('claude-opus-4-7-20260415');
    const plain = pricingFor('claude-opus-4-7');
    expect(dated).toEqual(plain);
    expect(dated.input).toBeGreaterThan(0);
  });

  it('returns zero pricing for an unknown model and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(pricingFor('nonexistent-model-9')).toEqual({
      input: 0, cached: 0, cacheCreation: 0, output: 0,
    });
    // Second call: still zero, but no new warn.
    pricingFor('nonexistent-model-9');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('costForUsage', () => {
  it('multiplies tokens by per-million-token cents and converts to dollars', () => {
    // Sonnet: input=300 cents/MTok → 1_000_000 input tokens = $3
    const cost = costForUsage('anthropic/claude-sonnet-4-6', {
      inputTokens: 1_000_000, outputTokens: 0,
    });
    expect(cost).toBeCloseTo(3, 5);
  });

  it('returns zero for unknown models', () => {
    _resetPricingWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cost = costForUsage('mystery-model', {
      inputTokens: 1_000_000, outputTokens: 1_000_000,
    });
    expect(cost).toBe(0);
    warn.mockRestore();
  });
});
