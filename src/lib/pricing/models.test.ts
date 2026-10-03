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

  it('resolves a GPT minor version to its tier price (codex sends gpt-5.4)', () => {
    // codex reports no costUsd, so the table is the only source — a bare
    // `gpt-5.4` must bridge to the `openai/gpt-5` tier or cost records $0.
    const minor = pricingFor('gpt-5.4');
    const tier = pricingFor('openai/gpt-5');
    expect(minor).toEqual(tier);
    expect(minor.input).toBeGreaterThan(0);
  });

  it('resolves a GPT mini minor version to its tier price', () => {
    const minor = pricingFor('gpt-5.4-mini');
    const tier = pricingFor('openai/gpt-5-mini');
    expect(minor).toEqual(tier);
    expect(minor.input).toBeGreaterThan(0);
  });

  it('resolves a GPT-6 variant id by its exact row (no minor version to strip)', () => {
    // `gpt-6-astra` has no `.x` for the tier bridge to drop, so the table
    // needs a literal row or Codex turns on Astra would record $0.
    const astra = pricingFor('gpt-6-astra');
    expect(astra).toEqual(pricingFor('openai/gpt-6-astra'));
    expect(astra.input).toBeGreaterThan(0);
    expect(astra.output).toBeGreaterThan(astra.input);
  });

  it('prices every bundled Codex model from its own row, not a tier guess', () => {
    // Codex reports no costUsd. Without an exact row, `gpt-6.1-sol` would
    // bridge to `gpt-6-sol` (wrong cached rate) and the 5.6 family to $0.
    expect(pricingFor('gpt-6.1-sol')).toEqual({ input: 200, cached: 10, cacheCreation: 250, output: 1000 });
    expect(pricingFor('gpt-6-sol')).toEqual({ input: 200, cached: 20, cacheCreation: 250, output: 1000 });
    expect(pricingFor('gpt-6-luna')).toEqual({ input: 10, cached: 1, cacheCreation: 12.5, output: 50 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const id of ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5']) {
      expect(pricingFor(id)).toEqual(pricingFor(`openai/${id}`));
      expect(pricingFor(id).input).toBeGreaterThan(0);
    }
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
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
