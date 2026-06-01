import { describe, expect, it } from 'vitest';
import { prettifyModelId, resolveModelInfo } from './context-window';

describe('prettifyModelId', () => {
  it('renders a dated Anthropic id, dropping the date', () => {
    expect(prettifyModelId('claude-opus-4-8')).toBe('Opus 4.8');
    expect(prettifyModelId('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(prettifyModelId('claude-sonnet-4-6')).toBe('Sonnet 4.6');
  });

  it('renders a brand-new minor version with no code change', () => {
    // The whole point of aliasing: a future Opus the table has never seen
    // still gets a correct label purely from the reported id.
    expect(prettifyModelId('claude-opus-4-9')).toBe('Opus 4.9');
    expect(prettifyModelId('claude-opus-5-0')).toBe('Opus 5.0');
  });

  it('renders a bare tier alias (pre-dispatch)', () => {
    expect(prettifyModelId('opus')).toBe('Opus');
    expect(prettifyModelId('haiku')).toBe('Haiku');
  });

  it('renders Codex ids', () => {
    expect(prettifyModelId('gpt-5.4')).toBe('GPT-5.4');
    expect(prettifyModelId('gpt-5.4-mini')).toBe('GPT-5.4 mini');
  });

  it('falls back to the raw id when unrecognized', () => {
    expect(prettifyModelId('some-future-model')).toBe('some-future-model');
  });
});

describe('resolveModelInfo', () => {
  it('returns null for empty input', () => {
    expect(resolveModelInfo(null)).toBeNull();
    expect(resolveModelInfo(undefined)).toBeNull();
    expect(resolveModelInfo('')).toBeNull();
  });

  it('caps Opus 4.7+ at 1M and Opus 4.6 at 200k', () => {
    expect(resolveModelInfo('claude-opus-4-8')?.contextWindow).toBe(1_000_000);
    expect(resolveModelInfo('claude-opus-4-7')?.contextWindow).toBe(1_000_000);
    expect(resolveModelInfo('claude-opus-4-9')?.contextWindow).toBe(1_000_000);
    expect(resolveModelInfo('claude-opus-4-6')?.contextWindow).toBe(200_000);
  });

  it('caps Sonnet 4.6+ at 1M and Haiku at 200k', () => {
    expect(resolveModelInfo('claude-sonnet-4-6')?.contextWindow).toBe(1_000_000);
    expect(resolveModelInfo('claude-haiku-4-5-20251001')?.contextWindow).toBe(200_000);
  });

  it('caps Codex at 400k', () => {
    expect(resolveModelInfo('gpt-5.4-mini')?.contextWindow).toBe(400_000);
  });

  it('returns label with a 0 cap (hides %) for unknown models', () => {
    const info = resolveModelInfo('mystery-model-7');
    expect(info).toEqual({ label: 'mystery-model-7', contextWindow: 0 });
  });

  it('pairs a derived label with a derived cap', () => {
    expect(resolveModelInfo('claude-opus-4-8')).toEqual({
      label: 'Opus 4.8',
      contextWindow: 1_000_000,
    });
  });
});
