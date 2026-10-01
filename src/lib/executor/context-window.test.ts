import { describe, expect, it } from 'vitest';
import { prettifyModelId, resolveModelInfo } from './context-window';

describe('prettifyModelId', () => {
  it('renders a dated Anthropic id, dropping the date', () => {
    expect(prettifyModelId('claude-opus-4-8')).toBe('Opus 4.8');
    expect(prettifyModelId('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(prettifyModelId('claude-sonnet-4-6')).toBe('Sonnet 4.6');
    expect(prettifyModelId('claude-fable-5')).toBe('Fable 5');
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
    expect(prettifyModelId('fable')).toBe('Fable');
  });

  it('renders Codex ids', () => {
    expect(prettifyModelId('gpt-5.4')).toBe('GPT-5.4');
    expect(prettifyModelId('gpt-5.4-mini')).toBe('GPT-5.4 mini');
    expect(prettifyModelId('gpt-5.6-sol')).toBe('GPT-5.6 Sol');
    expect(prettifyModelId('gpt-5.6-terra')).toBe('GPT-5.6 Terra');
    expect(prettifyModelId('gpt-5.6-luna')).toBe('GPT-5.6 Luna');
    expect(prettifyModelId('gpt-5.3-codex-spark')).toBe('GPT-5.3 Codex Spark');
    expect(prettifyModelId('gpt-6-astra')).toBe('GPT-6 Astra');
  });

  it('renders Antigravity Gemini slugs the way `agy models` names them', () => {
    expect(prettifyModelId('gemini-3.1-pro-high')).toBe('Gemini 3.1 Pro (High)');
    expect(prettifyModelId('gemini-3.8-flash-medium')).toBe('Gemini 3.8 Flash (Medium)');
    expect(prettifyModelId('gemini-3.6-flash-low')).toBe('Gemini 3.6 Flash (Low)');
    expect(prettifyModelId('gemini-2.5-flash-lite')).toBe('Gemini 2.5 Flash Lite');
    expect(prettifyModelId('gemini-3-pro-preview')).toBe('Gemini 3 Pro Preview');
    // Partner models served through Antigravity keep their own labels.
    expect(prettifyModelId('claude-sonnet-4-6')).toBe('Sonnet 4.6');
  });

  it('falls back to the raw id when unrecognized', () => {
    expect(prettifyModelId('some-future-model')).toBe('some-future-model');
    expect(prettifyModelId('gemini')).toBe('gemini');
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

  it('caps GPT-5 Codex models at 400k and GPT-6 at 1.05M', () => {
    expect(resolveModelInfo('gpt-5.4-mini')?.contextWindow).toBe(400_000);
    expect(resolveModelInfo('gpt-5.6-sol')?.contextWindow).toBe(400_000);
    expect(resolveModelInfo('gpt-6-astra')?.contextWindow).toBe(1_050_000);
  });

  it('caps Gemini 2 and later at 1,048,576 tokens', () => {
    expect(resolveModelInfo('gemini-3.1-pro-high')).toEqual({
      label: 'Gemini 3.1 Pro (High)',
      contextWindow: 1_048_576,
    });
    expect(resolveModelInfo('gemini-3.8-flash-medium')?.contextWindow).toBe(1_048_576);
    expect(resolveModelInfo('gemini-1.0-pro')?.contextWindow).toBe(0);
  });

  it('returns label with a 0 cap (hides %) for unknown models', () => {
    const info = resolveModelInfo('mystery-model-7');
    expect(info).toEqual({ label: 'mystery-model-7', contextWindow: 0 });
  });

  it('keeps Fable context usage hidden until its cap is documented', () => {
    expect(resolveModelInfo('claude-fable-5')).toEqual({
      label: 'Fable 5',
      contextWindow: 0,
    });
  });

  it('pairs a derived label with a derived cap', () => {
    expect(resolveModelInfo('claude-opus-4-8')).toEqual({
      label: 'Opus 4.8',
      contextWindow: 1_000_000,
    });
  });
});
