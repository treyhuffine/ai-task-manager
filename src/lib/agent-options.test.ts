import { describe, expect, it } from 'vitest';
import {
  EFFORT_OPTIONS,
  MODEL_OPTIONS,
  customModelOption,
  explicitAgentSelection,
  explicitEffortForModel,
  explicitModelForProvider,
  effortOptionsForModel,
  harnessSupportsEffort,
  normalizeCustomModelId,
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

  // Flow holds only canonical ids. The per-CLI rename (Claude spells this top
  // rung `ultracode`) happens in agentex at the flag boundary, so a second
  // mapping here would be a competing source of truth for the same fact.
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

/**
 * A pinned id is user input that ends up on a provider command line, and the
 * only thing standing between "typed by hand" and "sent to the CLI" is this
 * normalizer. It has to accept the punctuation real model slugs use and
 * nothing that suggests the value was a paste accident.
 */
describe('pinned model ids', () => {
  it('accepts the shapes providers actually publish', () => {
    for (const id of [
      'claude-opus-4-8',
      'claude-haiku-4-5-20251001',
      'gpt-5.4-mini',
      'anthropic/claude-opus-4-8',
      'qwen3:32b',
      'openai/gpt-oss-120b',
    ]) {
      expect(normalizeCustomModelId(id)).toBe(id);
    }
    expect(normalizeCustomModelId('  claude-opus-4-8\n')).toBe('claude-opus-4-8');
  });

  it('rejects values that are not a model id', () => {
    for (const id of ['', '   ', 'claude opus 4 8', '--model=opus', '$(whoami)', 'a'.repeat(161)]) {
      expect(normalizeCustomModelId(id)).toBeNull();
    }
    expect(normalizeCustomModelId(null)).toBeNull();
  });

  it('labels a pin by version and keeps the exact id in view', () => {
    expect(customModelOption('claude-opus-4-8')).toMatchObject({
      id: 'claude-opus-4-8',
      label: 'Opus 4.8',
      hint: 'claude-opus-4-8',
      custom: true,
    });
    // Nothing to prettify — the id stands in for its own label.
    expect(customModelOption('my-finetune-v3').label).toBe('my-finetune-v3');
  });

  it('resolves a pin like any other catalog model once merged in', () => {
    const catalog = [...MODEL_OPTIONS.claude_code, customModelOption('claude-opus-4-8')];
    expect(explicitAgentSelection('claude', { model: 'claude-opus-4-8' }, catalog)).toEqual({
      providerId: 'claude',
      harness: 'claude_code',
      model: 'claude-opus-4-8',
      variant: null,
      effort: 'medium',
    });
    // And an id nobody pinned still falls back to the flagship rather than
    // being handed to the CLI.
    expect(explicitModelForProvider('claude', 'not-a-model', catalog).id).toBe('opus');
  });
});
