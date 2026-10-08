import { describe, expect, it } from 'vitest';
import { preferredWorkResultReviewerSelection } from './reviewer-selection-defaults';

const normal = { defaultHarness: 'claude' as const, defaultModel: 'opus', defaultEffort: 'high' as const };
const settings = { defaultModel: 'opus', defaultVariant: null, defaultEffort: 'medium' as const };

describe('coherent reviewer preference inheritance', () => {
  it('resolves normal defaults for absent agent association and null preferences', () => {
    expect(preferredWorkResultReviewerSelection({}, null, normal, settings)).toEqual({ harness: 'claude', model: 'opus', variant: null, effort: 'high' });
    expect(preferredWorkResultReviewerSelection({}, { harness: null, model: null, variant: null, effort: null }, normal, settings)).toEqual({ harness: 'claude', model: 'opus', variant: null, effort: 'high' });
  });

  it('does not carry the global model or effort into another agent harness', () => {
    expect(preferredWorkResultReviewerSelection({}, { harness: 'codex' }, normal, { defaultModel: 'gpt-5.5', defaultVariant: null, defaultEffort: 'low' }))
      .toEqual({ harness: 'codex', model: 'gpt-5.5', variant: null, effort: 'low' });
  });

  it('keeps same-model agent choices and permits a per-request override without mutating input', () => {
    const agent = { harness: 'claude' as const, model: 'opus', effort: 'low' as const, variant: 'deep' };
    expect(preferredWorkResultReviewerSelection({ effort: 'medium' }, agent, normal, settings))
      .toEqual({ harness: 'claude', model: 'opus', effort: 'medium', variant: 'deep' });
    expect(agent).toEqual({ harness: 'claude', model: 'opus', effort: 'low', variant: 'deep' });
  });

  it('drops model-specific settings when choosing a different model', () => {
    expect(preferredWorkResultReviewerSelection({ model: 'sonnet' }, { model: 'opus', effort: 'ultra', variant: 'deep' }, normal, settings))
      .toEqual({ harness: 'claude', model: 'sonnet', effort: null, variant: null });
  });

  it('retains an unavailable saved choice rather than silently downgrading and permits explicit provider defaults', () => {
    const agent = { model: 'opus', effort: 'ultra' as const, variant: 'missing' };
    expect(preferredWorkResultReviewerSelection({}, agent, normal, settings)).toMatchObject({ effort: 'ultra', variant: 'missing' });
    expect(preferredWorkResultReviewerSelection({ effort: null, variant: null }, agent, normal, settings)).toMatchObject({ effort: null, variant: null });
  });
});

it('retains saved normal effort while its model inherits the harness default', () => {
  expect(preferredWorkResultReviewerSelection({}, null, { ...normal, defaultModel: null, defaultEffort: 'ultra' }, settings))
    .toMatchObject({ model: 'opus', effort: 'ultra' });
});

it('does not infer the old global tuple harness when its harness identity is absent', () => {
  expect(preferredWorkResultReviewerSelection({}, null, { defaultHarness: null, defaultModel: 'gpt-5.5', defaultEffort: 'low' }, settings))
    .toMatchObject({ harness: 'claude', model: 'opus', effort: 'medium' });
});
