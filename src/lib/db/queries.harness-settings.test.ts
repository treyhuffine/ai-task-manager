/**
 * `agent_harness_settings` — the per-provider allowlist that decides which
 * models the composer dropdown offers. The seed is the only thing standing
 * between a fresh install and an empty picker, and a too-narrow seed is
 * invisible: the dropdown just quietly lacks a model the CLI supports.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { APP_SHORT_ID } from '@/constants/app';

let tmpDir: string;
let q: typeof import('@/lib/db/queries');
let db: typeof import('@/lib/db');
let schema: typeof import('@/lib/db/schema');

const appRootEnv = `${APP_SHORT_ID.toUpperCase()}_ROOT`;
const dbPathEnv = `${APP_SHORT_ID.toUpperCase()}_DB_PATH`;
const mirrorDisabledEnv = `${APP_SHORT_ID.toUpperCase()}_MIRROR_DISABLED`;
const saveEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-harness-settings-'));
  for (const k of [appRootEnv, dbPathEnv, mirrorDisabledEnv]) saveEnv[k] = process.env[k];
  process.env[appRootEnv] = tmpDir;
  process.env[dbPathEnv] = path.join(tmpDir, 'data.db');
  process.env[mirrorDisabledEnv] = '1';

  q = await import('@/lib/db/queries');
  db = await import('@/lib/db');
  schema = await import('@/lib/db/schema');
});

afterAll(() => {
  for (const k of [appRootEnv, dbPathEnv, mirrorDisabledEnv]) {
    if (saveEnv[k] === undefined) delete process.env[k];
    else process.env[k] = saveEnv[k];
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  db.getDb().delete(schema.harnessSettings).run();
});

describe('ensureHarnessSettings', () => {
  it('seeds every Claude tier alias, Fable included', () => {
    // The aliases resolve to whatever the installed CLI ships as that tier, so
    // none of them go stale and there is no reason to withhold one.
    expect(q.ensureHarnessSettings('claude').enabledModels).toEqual([
      'opus',
      'sonnet',
      'haiku',
      'fable',
    ]);
  });

  it('seeds only the curated Codex models and leaves the legacy tail off', () => {
    const enabled = q.ensureHarnessSettings('codex').enabledModels;
    expect(enabled).toEqual([
      'gpt-6.1-sol',
      'gpt-6-astra',
      'gpt-6-sol',
      'gpt-6-luna',
    ]);
    expect(enabled).not.toContain('gpt-5.6-sol');
  });

  it('records the whole bundled catalog as known so the legacy tail is never mistaken for new', () => {
    const row = q.ensureHarnessSettings('codex');
    expect(row.knownModels).toEqual([
      'gpt-6.1-sol',
      'gpt-6-astra',
      'gpt-6-sol',
      'gpt-6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
    ]);
  });

  it('auto-enables a model bundled after a row was last seen, without re-adding user removals', () => {
    // A row as it looked before astra shipped: no knownModels, and the user had
    // already trimmed 5.5 out of the seeded set.
    q.upsertHarnessSettings({
      harness: 'codex',
      enabledModels: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
      customModels: [],
      knownModels: undefined,
      defaultModel: 'gpt-5.6-sol',
      defaultVariant: null,
      defaultEffort: null,
      catalogRefreshedAt: null,
    });

    const row = q.ensureHarnessSettings('codex');
    expect(row.enabledModels).toContain('gpt-6-astra');      // shipped after → surfaces
    expect(row.enabledModels).not.toContain('gpt-5.5');       // prior removal → respected
    expect(row.enabledModels).not.toContain('gpt-5.4');       // legacy → never auto-on
    expect(row.defaultModel).toBe('gpt-5.6-sol');             // default untouched
    expect(row.knownModels).toContain('gpt-6-astra');         // snapshot advanced

    // Reconciliation is one-shot: a second pass neither changes nor rewrites.
    const again = q.ensureHarnessSettings('codex');
    expect(again.enabledModels).toEqual(row.enabledModels);
    expect(again.updatedAt).toBe(row.updatedAt);
  });

  it('keeps a curated model off once the user turns it off after it shipped', () => {
    q.ensureHarnessSettings('codex'); // astra enabled + known covers it
    q.setEnabledHarnessModels(
      'codex',
      ['gpt-5.5', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
      'gpt-5.6-sol',
    );
    expect(q.ensureHarnessSettings('codex').enabledModels).not.toContain('gpt-6-astra');
  });

  it('defaults to the flagship model of the seeded set', () => {
    expect(q.ensureHarnessSettings('claude').defaultModel).toBe('opus');
  });

  it('never re-widens an allowlist the user has narrowed', () => {
    q.ensureHarnessSettings('claude');
    q.setEnabledHarnessModels('claude', ['opus'], 'opus');
    expect(q.ensureHarnessSettings('claude').enabledModels).toEqual(['opus']);
  });
});

/**
 * Pinned ids are the only models in this table the user typed rather than
 * picked, so nothing else in the app can regenerate one that gets dropped by
 * accident: an ordinary "save models" round trip has to leave them alone, and
 * removing one has to leave the harness in a usable state rather than pointing
 * its default at an id that no longer resolves anywhere.
 */
describe('custom (pinned) harness models', () => {
  it('pins an exact id and makes it visible in the same write', () => {
    q.ensureHarnessSettings('claude');
    const settings = q.addCustomHarnessModel('claude', 'claude-opus-4-8');
    expect(settings.customModels).toEqual(['claude-opus-4-8']);
    // Enabling is not a convenience: every downstream validator resolves
    // against the visible set, so a pin that isn't enabled can't be selected.
    expect(settings.enabledModels).toContain('claude-opus-4-8');
  });

  it('trims and rejects ids that cannot be a model', () => {
    q.ensureHarnessSettings('claude');
    expect(q.addCustomHarnessModel('claude', '  claude-opus-4-8  ').customModels)
      .toEqual(['claude-opus-4-8']);
    expect(() => q.addCustomHarnessModel('claude', 'claude opus 4 8')).toThrow();
    expect(() => q.addCustomHarnessModel('claude', '')).toThrow();
  });

  it('is idempotent, so a repeated pin does not duplicate the row', () => {
    q.ensureHarnessSettings('claude');
    q.addCustomHarnessModel('claude', 'claude-opus-4-8');
    const settings = q.addCustomHarnessModel('claude', 'claude-opus-4-8');
    expect(settings.customModels).toEqual(['claude-opus-4-8']);
    expect(settings.enabledModels.filter((id) => id === 'claude-opus-4-8')).toHaveLength(1);
  });

  it('adopts the pin as the default only when there is no default yet', () => {
    q.setEnabledHarnessModels('cursor', [], null);
    expect(q.addCustomHarnessModel('cursor', 'composer-1').defaultModel).toBe('composer-1');
    q.ensureHarnessSettings('claude');
    expect(q.addCustomHarnessModel('claude', 'claude-opus-4-8').defaultModel).toBe('opus');
  });

  it('survives an ordinary model save', () => {
    q.ensureHarnessSettings('claude');
    q.addCustomHarnessModel('claude', 'claude-opus-4-8');
    const saved = q.setEnabledHarnessModels('claude', ['opus', 'claude-opus-4-8'], 'opus');
    expect(saved.customModels).toEqual(['claude-opus-4-8']);
    expect(q.upsertHarnessSettings({
      ...saved,
      customModels: undefined,
      catalogRefreshedAt: new Date().toISOString(),
    }).customModels).toEqual(['claude-opus-4-8']);
  });

  it('unpins from both lists and hands the default to a model that resolves', () => {
    q.ensureHarnessSettings('claude');
    q.addCustomHarnessModel('claude', 'claude-opus-4-8');
    q.setHarnessDefaultSelection('claude', { model: 'claude-opus-4-8', effort: 'high' });
    const settings = q.removeCustomHarnessModel('claude', 'claude-opus-4-8');
    expect(settings.customModels).toEqual([]);
    expect(settings.enabledModels).not.toContain('claude-opus-4-8');
    expect(settings.defaultModel).toBe('opus');
    // The effort belonged to the model that just left.
    expect(settings.defaultEffort).toBeNull();
  });

  it('leaves an unrelated default alone', () => {
    q.ensureHarnessSettings('claude');
    q.addCustomHarnessModel('claude', 'claude-opus-4-8');
    expect(q.removeCustomHarnessModel('claude', 'claude-opus-4-8').defaultModel).toBe('opus');
  });

  it('ignores an id that was never pinned', () => {
    const before = q.ensureHarnessSettings('claude');
    expect(q.removeCustomHarnessModel('claude', 'opus').enabledModels).toEqual(before.enabledModels);
  });

  it('keeps a pin that shadows a real catalog model visible after unpinning', () => {
    // Pinning `opus` by hand is redundant but legal. Unpinning it must drop
    // only the pin, because the alias still resolves on its own.
    q.ensureHarnessSettings('claude');
    q.addCustomHarnessModel('claude', 'opus');
    const settings = q.removeCustomHarnessModel('claude', 'opus');
    expect(settings.customModels).toEqual([]);
    expect(settings.enabledModels).toContain('opus');
    expect(settings.defaultModel).toBe('opus');
  });

  it('refuses to leave the active harness with nothing to run', () => {
    q.setEnabledHarnessModels('cursor', [], null);
    q.addCustomHarnessModel('cursor', 'composer-1');
    q.setHomeDefaultSelection({ harness: 'cursor', model: 'composer-1', variant: null, effort: null });
    expect(() => q.removeCustomHarnessModel('cursor', 'composer-1')).toThrow(/at least one/);
    // `user_state` outlives the per-test settings reset, so hand the active
    // harness back rather than leaking it into whatever runs next.
    q.updateUserState({ defaultHarness: 'claude' });
  });
});

/**
 * The home's default for new work and each harness's own default are two
 * settings (docs/default-selection.md). They used to share a write path, and
 * a home ended up with Settings showing Claude's own Opus · Medium while every
 * new chat ran on the home's Fable · Extra high.
 */
describe('the default for new work', () => {
  beforeEach(() => {
    q.updateUserState({ defaultHarness: null, defaultModel: null, defaultVariant: null, defaultEffort: null });
  });

  afterAll(() => {
    q.updateUserState({ defaultHarness: null, defaultModel: null, defaultVariant: null, defaultEffort: null });
  });

  it("is saved whole and leaves the harness's own default alone", () => {
    q.ensureHarnessSettings('claude');
    q.setHarnessDefaultSelection('claude', { model: 'opus', effort: 'medium' });
    const home = q.setHomeDefaultSelection({ harness: 'claude', model: 'fable', variant: null, effort: 'xhigh' });

    expect(home).toMatchObject({ defaultHarness: 'claude', defaultModel: 'fable', defaultVariant: null, defaultEffort: 'xhigh' });
    expect(q.ensureHarnessSettings('claude')).toMatchObject({ defaultModel: 'opus', defaultEffort: 'medium' });
  });

  it('keeps the variant with the model', () => {
    q.setEnabledHarnessModels('opencode', ['xai/grok-4.5'], 'xai/grok-4.5');
    q.setHomeDefaultSelection({ harness: 'opencode', model: 'xai/grok-4.5', variant: 'fast', effort: null });
    expect(q.getUserState()).toMatchObject({ defaultModel: 'xai/grok-4.5', defaultVariant: 'fast' });
  });

  it('turns its model on without hiding any other', () => {
    q.setEnabledHarnessModels('claude', ['opus', 'sonnet'], 'opus');
    q.setHomeDefaultSelection({ harness: 'claude', model: 'haiku', variant: null, effort: 'low' });
    expect(q.ensureHarnessSettings('claude')).toMatchObject({ enabledModels: ['opus', 'sonnet', 'haiku'], defaultModel: 'opus' });
  });

  it("doesn't move when the default harness's own default is saved", () => {
    q.ensureHarnessSettings('claude');
    q.setHomeDefaultSelection({ harness: 'claude', model: 'fable', variant: null, effort: 'xhigh' });
    q.setHarnessDefaultSelection('claude', { model: 'opus', effort: 'medium' });
    expect(q.getUserState()).toMatchObject({ defaultHarness: 'claude', defaultModel: 'fable', defaultEffort: 'xhigh' });
  });

  it('stays visible: its model cannot be hidden while it is the default', () => {
    q.ensureHarnessSettings('claude');
    q.setHomeDefaultSelection({ harness: 'claude', model: 'fable', variant: null, effort: 'xhigh' });
    expect(() => q.setEnabledHarnessModels('claude', ['opus', 'sonnet'], 'opus')).toThrow(/default for new work/);
    // Another harness's list is its own business.
    expect(q.setEnabledHarnessModels('codex', ['gpt-6.1-sol'], 'gpt-6.1-sol').enabledModels).toEqual(['gpt-6.1-sol']);
  });

  it("moves to the harness's own default when its pinned model is unpinned", () => {
    q.ensureHarnessSettings('claude');
    q.setHarnessDefaultSelection('claude', { model: 'sonnet', effort: 'high' });
    q.addCustomHarnessModel('claude', 'claude-opus-4-8');
    q.setHomeDefaultSelection({ harness: 'claude', model: 'claude-opus-4-8', variant: null, effort: 'max' });

    q.removeCustomHarnessModel('claude', 'claude-opus-4-8');
    expect(q.getUserState()).toMatchObject({ defaultModel: 'sonnet', defaultEffort: 'high' });
  });

  it('is untouched when another pin on its harness is removed', () => {
    q.ensureHarnessSettings('claude');
    q.addCustomHarnessModel('claude', 'claude-opus-4-8');
    q.setHomeDefaultSelection({ harness: 'claude', model: 'fable', variant: null, effort: 'xhigh' });
    q.removeCustomHarnessModel('claude', 'claude-opus-4-8');
    expect(q.getUserState()).toMatchObject({ defaultModel: 'fable', defaultEffort: 'xhigh' });
  });
});


describe('defaultTriggerHarness', () => {
  it('uses Codex only when there is no saved harness', () => {
    q.updateUserState({ defaultHarness: null });
    expect(q.defaultTriggerHarness()).toBe('codex');
    expect(q.getUserState()?.defaultHarness).toBeNull();
  });

  it('preserves an existing Claude choice', () => {
    q.updateUserState({ defaultHarness: 'claude' });
    expect(q.defaultTriggerHarness()).toBe('claude');
    expect(q.getUserState()?.defaultHarness).toBe('claude');
  });
});


it('keeps a saved Antigravity trigger default when rollout disables execution', () => {
  const previous = process.env.NEXT_PUBLIC_RI_ANTIGRAVITY_ENABLED;
  process.env.NEXT_PUBLIC_RI_ANTIGRAVITY_ENABLED = 'false';
  try {
    q.updateUserState({ defaultHarness: 'antigravity' });
    expect(q.defaultTriggerHarness()).toBe('antigravity');
    expect(q.getUserState()?.defaultHarness).toBe('antigravity');
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_RI_ANTIGRAVITY_ENABLED;
    else process.env.NEXT_PUBLIC_RI_ANTIGRAVITY_ENABLED = previous;
  }
});
