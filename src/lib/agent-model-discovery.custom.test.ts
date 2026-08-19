/**
 * Pinned ids have to reach the *validation* catalog, not just the picker.
 * Every gate between typing an id and running it — the session PATCH, the
 * allowlist route, the dispatch preflight — asks `getAgentModelCatalog`
 * whether the model exists, and a pin that only lived in the UI would be
 * rejected by all three with a message about the provider's catalog.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { APP_SHORT_ID } from '@/constants/app';

let tmpDir: string;
let q: typeof import('@/lib/db/queries');
let discovery: typeof import('@/lib/agent-model-discovery');
let db: typeof import('@/lib/db');
let schema: typeof import('@/lib/db/schema');

const appRootEnv = `${APP_SHORT_ID.toUpperCase()}_ROOT`;
const dbPathEnv = `${APP_SHORT_ID.toUpperCase()}_DB_PATH`;
const mirrorDisabledEnv = `${APP_SHORT_ID.toUpperCase()}_MIRROR_DISABLED`;
const saveEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-custom-models-'));
  for (const k of [appRootEnv, dbPathEnv, mirrorDisabledEnv]) saveEnv[k] = process.env[k];
  process.env[appRootEnv] = tmpDir;
  process.env[dbPathEnv] = path.join(tmpDir, 'data.db');
  process.env[mirrorDisabledEnv] = '1';

  q = await import('@/lib/db/queries');
  discovery = await import('@/lib/agent-model-discovery');
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

describe('customModelCatalog', () => {
  it('turns pinned ids into usable catalog entries', () => {
    q.ensureAgentHarnessSettings('claude');
    q.addCustomHarnessModel('claude', 'claude-opus-4-8');
    expect(discovery.customModelCatalog('claude')).toEqual([
      { id: 'claude-opus-4-8', label: 'Opus 4.8', hint: 'claude-opus-4-8', custom: true, availability: 'available' },
    ]);
  });

  it('is empty for a provider with no settings row, without creating one', () => {
    expect(discovery.customModelCatalog('codex')).toEqual([]);
    expect(q.getAgentHarnessSettings('codex')).toBeUndefined();
  });

  it('reads through live rather than through the discovery cache', () => {
    q.ensureAgentHarnessSettings('claude');
    expect(discovery.customModelCatalog('claude')).toEqual([]);
    // A pin is a local decision, so it has to be usable on the next read
    // instead of after the 15-minute provider catalog TTL.
    q.addCustomHarnessModel('claude', 'claude-sonnet-4-9');
    expect(discovery.customModelCatalog('claude').map((m) => m.id)).toEqual(['claude-sonnet-4-9']);
    q.removeCustomHarnessModel('claude', 'claude-sonnet-4-9');
    expect(discovery.customModelCatalog('claude')).toEqual([]);
  });
});
