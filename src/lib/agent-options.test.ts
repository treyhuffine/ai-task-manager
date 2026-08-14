import { describe, expect, it } from 'vitest';
import {
  EFFORT_OPTIONS,
  explicitAgentSelection,
  explicitEffortForModel,
  explicitModelForProvider,
  effortOptionsForModel,
  harnessSupportsEffort,
  providerEffortValue,
  type ModelOption,
} from './agent-options';

describe('agent effort options', () => {
  it('shows effort for Claude and Codex harnesses', () => {
    expect(harnessSupportsEffort('claude_code')).toBe(true);
    expect(harnessSupportsEffort('codex')).toBe(true);
    expect(harnessSupportsEffort('other')).toBe(false);
  });

  it('filters choices to the selected model catalog capabilities', () => {
    const model: ModelOption = {
      id: 'gpt-test',
      label: 'GPT Test',
      supportedEfforts: ['low', 'high', 'ultra'],
    };

    expect(effortOptionsForModel('codex', model).map((option) => option.id)).toEqual([
      'low',
      'high',
      'ultra',
    ]);
  });

  it('uses conservative Codex choices when capability metadata is unavailable', () => {
    expect(effortOptionsForModel('codex', null).map((option) => option.id)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
    expect(
      effortOptionsForModel('codex', { id: 'custom', label: 'Custom' }).map(
        (option) => option.id,
      ),
    ).toEqual(['low', 'medium', 'high', 'xhigh']);
  });

  it('keeps Claude on its provider-supported levels', () => {
    expect(effortOptionsForModel('claude_code', null).map((option) => option.id)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultra',
    ]);
    expect(EFFORT_OPTIONS.at(-1)?.id).toBe('ultra');
  });

  it('names the top rung the way each provider names it', () => {
    const claude = effortOptionsForModel('claude_code', null).at(-1);
    expect(claude).toMatchObject({ id: 'ultra', label: 'Ultracode', shortLabel: 'ultracode' });

    const codex = effortOptionsForModel('codex', {
      id: 'gpt-test',
      label: 'GPT Test',
      supportedEfforts: ['ultra'],
    }).at(-1);
    expect(codex).toMatchObject({ id: 'ultra', label: 'Ultra', shortLabel: 'ultra' });
  });

  it('sends the top rung under the name each CLI accepts', () => {
    // `claude --effort ultra` only warns and silently drops to the default
    // effort, so the rename is the difference between running ultracode and
    // quietly running whatever the session would have run anyway.
    expect(providerEffortValue('claude_code', 'ultra')).toBe('ultracode');
    expect(providerEffortValue('codex', 'ultra')).toBe('ultra');
    expect(providerEffortValue('claude_code', 'xhigh')).toBe('xhigh');
    expect(providerEffortValue('nonsense', 'ultra')).toBe('ultra');
  });

  it('resolves null values to an explicit model and effort', () => {
    expect(explicitAgentSelection('claude')).toEqual({
      providerId: 'claude',
      harness: 'claude_code',
      model: 'opus',
      variant: null,
      effort: 'medium',
    });
  });

  it('keeps model variants independent from reasoning effort', () => {
    const catalog: ModelOption[] = [{
      id: 'anthropic/claude',
      label: 'Claude',
      variants: [
        { id: 'fast', name: 'Fast' },
        { id: 'deep', name: 'Deep', isDefault: true },
      ],
    }];
    expect(explicitAgentSelection('opencode', {
      model: 'anthropic/claude',
      variant: 'fast',
    }, catalog)).toMatchObject({
      model: 'anthropic/claude',
      variant: 'fast',
      effort: null,
    });
    expect(explicitAgentSelection('opencode', {
      model: 'anthropic/claude',
    }, catalog).variant).toBe('deep');
  });

  it('preserves a server-validated dynamic model and variant at the DB boundary', () => {
    expect(explicitAgentSelection('opencode', {
      model: 'custom/model',
      variant: 'provider-native',
    })).toMatchObject({
      model: 'custom/model',
      variant: 'provider-native',
    });
  });

  it('rejects a model from the other provider namespace', () => {
    expect(explicitModelForProvider('claude', 'gpt-5.5').id).toBe('opus');
    expect(explicitModelForProvider('codex', 'sonnet').id).toBe('gpt-5.5');
  });

  it('accepts the Claude Code Fable alias', () => {
    expect(explicitModelForProvider('claude', 'fable')).toMatchObject({
      id: 'fable',
      label: 'Fable',
    });
  });

  it('uses a model-supported explicit effort when the saved value is invalid', () => {
    const model: ModelOption = {
      id: 'gpt-test',
      label: 'GPT Test',
      supportedEfforts: ['low', 'ultra'],
      defaultEffort: 'ultra',
    };
    expect(explicitEffortForModel('codex', model, 'medium')).toBe('ultra');
  });
});
