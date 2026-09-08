import { describe, expect, it } from 'vitest';
import {
  EFFORT_OPTIONS,
  MODEL_OPTIONS,
  bundledModelIds,
  curatedDefaultModelIds,
  customModelOption,
  explicitAgentSelection,
  explicitEffortForModel,
  explicitModelForProvider,
  effortOptionsForModel,
  harnessSupportsEffort,
  normalizeCustomModelId,
  reconcileEnabledModels,
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
    expect(explicitModelForProvider('codex', 'sonnet').id).toBe('gpt-6-astra');
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

describe('curated vs legacy bundled models', () => {
  it('excludes the legacy Codex tail from the curated defaults but keeps it bundled', () => {
    const curated = curatedDefaultModelIds('codex');
    const bundled = bundledModelIds('codex');
    expect(curated).toEqual([
      'gpt-6-astra',
      'gpt-5.5',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
    ]);
    for (const legacy of ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex-spark']) {
      expect(curated).not.toContain(legacy);
      expect(bundled).toContain(legacy);
    }
  });

  it('treats every Claude tier alias as curated', () => {
    expect(curatedDefaultModelIds('claude')).toEqual(bundledModelIds('claude'));
  });
});

describe('reconcileEnabledModels', () => {
  it('adds a newly bundled curated model a pre-reconcile row never saw', () => {
    // known = null → the frozen pre-reconcile snapshot, which predates astra.
    const r = reconcileEnabledModels('codex', ['gpt-5.6-sol'], null);
    expect(r.enabledModels).toContain('gpt-6-astra');
    expect(r.enabledModels[0]).toBe('gpt-5.6-sol'); // appended, existing order kept
    expect(r.changed).toBe(true);
    expect(r.knownModels).toContain('gpt-6-astra');
  });

  it('leaves a model already in the known snapshot off (a deliberate user removal)', () => {
    const known = bundledModelIds('codex'); // already includes astra
    const r = reconcileEnabledModels('codex', ['gpt-5.6-sol'], known);
    expect(r.enabledModels).toEqual(['gpt-5.6-sol']);
    expect(r.changed).toBe(false);
  });

  it('never auto-enables a legacy model, even for a pre-reconcile row', () => {
    const r = reconcileEnabledModels('codex', ['gpt-5.6-sol'], null);
    expect(r.enabledModels).not.toContain('gpt-5.4');
    expect(r.enabledModels).not.toContain('gpt-5.3-codex-spark');
  });

  it('is a no-op for a row already current with the catalog', () => {
    const r = reconcileEnabledModels(
      'codex',
      curatedDefaultModelIds('codex'),
      bundledModelIds('codex'),
    );
    expect(r.changed).toBe(false);
  });
});
