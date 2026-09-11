import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 });

describe('external Stream idempotency', () => {
  let root: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-stream-external-'));
    const env: Record<string, string> = {
      RI_ROOT: root,
      RI_DB_PATH: path.join(root, 'data.db'),
      RI_MIRROR_DISABLED: '1',
    };
    for (const [key, value] of Object.entries(env)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
    vi.resetModules();
  });

  afterEach(async () => {
    const { resetDb } = await import('@/lib/db');
    resetDb();
    for (const key of Object.keys(savedEnv)) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    fs.rmSync(root, { recursive: true, force: true });
    vi.resetModules();
  });

  it('returns the canonical row when the same external item is inserted twice', async () => {
    const q = await import('@/lib/db/queries');
    const first = q.createExternalStream({
      rawText: 'First delivery',
      source: 'webhook',
      media: 'voice',
      origin: 'webhook',
      externalSource: 'pebble-index-01',
      externalId: '1788112345678',
      status: 'pending',
    });
    const duplicate = q.createExternalStream({
      rawText: 'Duplicate delivery',
      source: 'webhook',
      media: 'voice',
      origin: 'webhook',
      externalSource: 'pebble-index-01',
      externalId: '1788112345678',
      status: 'pending',
    });

    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.row.id).toBe(first.row.id);
    expect(duplicate.row.rawText).toBe('First delivery');
    expect(q.listStream({ limit: 10 })).toHaveLength(1);
  });

  it('allows different external keys and any number of internal captures', async () => {
    const q = await import('@/lib/db/queries');
    const first = q.createExternalStream({
      rawText: 'Pebble',
      externalSource: 'pebble-index-01',
      externalId: 'same-upstream-id',
    });
    const second = q.createExternalStream({
      rawText: 'Pocket',
      externalSource: 'pocket',
      externalId: 'same-upstream-id',
    });
    const internalOne = q.createStream({ rawText: 'One' });
    const internalTwo = q.createStream({ rawText: 'Two' });

    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(new Set([
      first.row.id,
      second.row.id,
      internalOne.id,
      internalTwo.id,
    ]).size).toBe(4);
  });

  it('enforces the external key at the database level', async () => {
    const q = await import('@/lib/db/queries');
    const { getDb } = await import('@/lib/db');
    const { stream } = await import('@/lib/db/schema');
    q.createExternalStream({
      rawText: 'Canonical',
      externalSource: 'pebble-index-01',
      externalId: 'recording-1',
    });

    expect(() => getDb().insert(stream).values({
      id: 'raw-duplicate',
      rawText: 'Bypass attempt',
      source: 'capture', media: 'text', origin: 'internal', status: 'pending',
      externalSource: 'pebble-index-01',
      externalId: 'recording-1',
    }).run()).toThrow(/UNIQUE constraint failed/i);
  });
});
