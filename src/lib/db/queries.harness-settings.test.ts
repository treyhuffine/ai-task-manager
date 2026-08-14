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

  it('seeds only the current Codex models and leaves the superseded tail off', () => {
    const enabled = q.ensureAgentHarnessSettings('codex').enabledModels;
    expect(enabled).toEqual(['gpt-5.5', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
    expect(enabled).not.toContain('gpt-5.4');
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
