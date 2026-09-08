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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-harness-settings-'));
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
  db.getDb().delete(schema.agentHarnessSettings).run();
});

describe('ensureAgentHarnessSettings', () => {
  it('seeds every Claude tier alias, Fable included', () => {
    // The aliases resolve to whatever the installed CLI ships as that tier, so
    // none of them go stale and there is no reason to withhold one.
    expect(q.ensureAgentHarnessSettings('claude').enabledModels).toEqual([
      'opus',
      'sonnet',
      'haiku',
      'fable',
    ]);
  });

  it('seeds only the curated Codex models and leaves the legacy tail off', () => {
    const enabled = q.ensureAgentHarnessSettings('codex').enabledModels;
    expect(enabled).toEqual([
      'gpt-6-astra',
      'gpt-5.5',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
    ]);
    expect(enabled).not.toContain('gpt-5.4');
  });

  it('records the whole bundled catalog as known so the legacy tail is never mistaken for new', () => {
    const row = q.ensureAgentHarnessSettings('codex');
    expect(row.knownModels).toEqual([
      'gpt-6-astra',
      'gpt-5.5',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex-spark',
    ]);
  });

  it('auto-enables a model bundled after a row was last seen, without re-adding user removals', () => {
    // A row as it looked before astra shipped: no knownModels, and the user had
    // already trimmed 5.5 out of the seeded set.
    q.upsertAgentHarnessSettings({
      harness: 'codex',
      enabledModels: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
      customModels: [],
      knownModels: undefined,
      defaultModel: 'gpt-5.6-sol',
      defaultVariant: null,
      defaultEffort: null,
      catalogRefreshedAt: null,
    });

    const row = q.ensureAgentHarnessSettings('codex');
    expect(row.enabledModels).toContain('gpt-6-astra');      // shipped after → surfaces
    expect(row.enabledModels).not.toContain('gpt-5.5');       // prior removal → respected
    expect(row.enabledModels).not.toContain('gpt-5.4');       // legacy → never auto-on
    expect(row.defaultModel).toBe('gpt-5.6-sol');             // default untouched
    expect(row.knownModels).toContain('gpt-6-astra');         // snapshot advanced

    // Reconciliation is one-shot: a second pass neither changes nor rewrites.
    const again = q.ensureAgentHarnessSettings('codex');
    expect(again.enabledModels).toEqual(row.enabledModels);
    expect(again.updatedAt).toBe(row.updatedAt);
  });

  it('keeps a curated model off once the user turns it off after it shipped', () => {
    q.ensureAgentHarnessSettings('codex'); // astra enabled + known covers it
    q.setEnabledHarnessModels(
      'codex',
      ['gpt-5.5', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
      'gpt-5.6-sol',
    );
    expect(q.ensureAgentHarnessSettings('codex').enabledModels).not.toContain('gpt-6-astra');
  });

  it('defaults to the flagship model of the seeded set', () => {
    expect(q.ensureAgentHarnessSettings('claude').defaultModel).toBe('opus');
  });

  it('never re-widens an allowlist the user has narrowed', () => {
    q.ensureAgentHarnessSettings('claude');
    q.setEnabledHarnessModels('claude', ['opus'], 'opus');
    expect(q.ensureAgentHarnessSettings('claude').enabledModels).toEqual(['opus']);
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
    q.ensureAgentHarnessSettings('claude');
    const settings = q.addCustomHarnessModel('claude', 'claude-opus-4-8');
    expect(settings.customModels).toEqual(['claude-opus-4-8']);
    // Enabling is not a convenience: every downstream validator resolves
    // against the visible set, so a pin that isn't enabled can't be selected.
    expect(settings.enabledModels).toContain('claude-opus-4-8');
  });

  it('trims and rejects ids that cannot be a model', () => {
    q.ensureAgentHarnessSettings('claude');
    expect(q.addCustomHarnessModel('claude', '  claude-opus-4-8  ').customModels)
      .toEqual(['claude-opus-4-8']);
    expect(() => q.addCustomHarnessModel('claude', 'claude opus 4 8')).toThrow();
    expect(() => q.addCustomHarnessModel('claude', '')).toThrow();
  });

  it('is idempotent, so a repeated pin does not duplicate the row', () => {
    q.ensureAgentHarnessSettings('claude');
    q.addCustomHarnessModel('claude', 'claude-opus-4-8');
    const settings = q.addCustomHarnessModel('claude', 'claude-opus-4-8');
    expect(settings.customModels).toEqual(['claude-opus-4-8']);
    expect(settings.enabledModels.filter((id) => id === 'claude-opus-4-8')).toHaveLength(1);
  });

  it('adopts the pin as the default only when there is no default yet', () => {
    q.setEnabledHarnessModels('cursor', [], null);
    expect(q.addCustomHarnessModel('cursor', 'composer-1').defaultModel).toBe('composer-1');
    q.ensureAgentHarnessSettings('claude');
    expect(q.addCustomHarnessModel('claude', 'claude-opus-4-8').defaultModel).toBe('opus');
  });

  it('survives an ordinary model save', () => {
    q.ensureAgentHarnessSettings('claude');
    q.addCustomHarnessModel('claude', 'claude-opus-4-8');
    const saved = q.setEnabledHarnessModels('claude', ['opus', 'claude-opus-4-8'], 'opus');
    expect(saved.customModels).toEqual(['claude-opus-4-8']);
    expect(q.upsertAgentHarnessSettings({
      ...saved,
      customModels: undefined,
      catalogRefreshedAt: new Date().toISOString(),
    }).customModels).toEqual(['claude-opus-4-8']);
  });

  it('unpins from both lists and hands the default to a model that resolves', () => {
    q.ensureAgentHarnessSettings('claude');
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
    q.ensureAgentHarnessSettings('claude');
    q.addCustomHarnessModel('claude', 'claude-opus-4-8');
    expect(q.removeCustomHarnessModel('claude', 'claude-opus-4-8').defaultModel).toBe('opus');
  });

  it('ignores an id that was never pinned', () => {
    const before = q.ensureAgentHarnessSettings('claude');
    expect(q.removeCustomHarnessModel('claude', 'opus').enabledModels).toEqual(before.enabledModels);
  });

  it('keeps a pin that shadows a real catalog model visible after unpinning', () => {
    // Pinning `opus` by hand is redundant but legal. Unpinning it must drop
    // only the pin, because the alias still resolves on its own.
    q.ensureAgentHarnessSettings('claude');
    q.addCustomHarnessModel('claude', 'opus');
    const settings = q.removeCustomHarnessModel('claude', 'opus');
    expect(settings.customModels).toEqual([]);
    expect(settings.enabledModels).toContain('opus');
    expect(settings.defaultModel).toBe('opus');
  });

  it('refuses to leave the active harness with nothing to run', () => {
    q.setEnabledHarnessModels('cursor', [], null);
    q.addCustomHarnessModel('cursor', 'composer-1');
    q.setActiveHarness('cursor');
    expect(() => q.removeCustomHarnessModel('cursor', 'composer-1')).toThrow(/at least one/);
    // `user_state` outlives the per-test settings reset, so hand the active
    // harness back rather than leaking it into whatever runs next.
    q.updateUserState({ defaultAgentHarness: 'claude' });
  });
});
