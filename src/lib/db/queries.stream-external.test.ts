import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 });

describe('external Stream idempotency', () => {
  let root: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-stream-external-'));
    const env: Record<string, string> = {
      FLOW_ROOT: root,
      FLOW_DB_PATH: path.join(root, 'data.db'),
      FLOW_MIRROR_DISABLED: '1',
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
      externalSource: 'pebble-index-01',
      externalId: 'recording-1',
    }).run()).toThrow(/UNIQUE constraint failed/i);
  });
});

describe('external Stream uniqueness migration', () => {
  it('preserves legacy duplicate rows while assigning only one canonical key', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE stream (
        id TEXT PRIMARY KEY NOT NULL,
        created_at TEXT NOT NULL,
        external_source TEXT,
        external_id TEXT
      );
      CREATE INDEX stream_external_id_idx
        ON stream (external_source, external_id);
      INSERT INTO stream VALUES
        ('first', '2026-08-30T10:00:00Z', 'pocket', 'recording-1'),
        ('second', '2026-08-30T10:01:00Z', 'pocket', 'recording-1'),
        ('third', '2026-08-30T10:02:00Z', 'pocket', 'recording-1'),
        ('other-source', '2026-08-30T10:03:00Z', 'pebble-index-01', 'recording-1'),
        ('internal', '2026-08-30T10:04:00Z', NULL, NULL);
    `);

    const migration = fs.readFileSync(
      path.join(process.cwd(), 'drizzle/0015_curious_caretaker.sql'),
      'utf8',
    );
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim()) db.exec(statement);
    }

    const rows = db.prepare(`
      SELECT id, external_id AS externalId
      FROM stream
      WHERE external_source = 'pocket'
      ORDER BY created_at
    `).all() as Array<{ id: string; externalId: string | null }>;
    expect(rows[0]).toEqual({ id: 'first', externalId: 'recording-1' });
    expect(rows[1]).toEqual({ id: 'second', externalId: null });
    expect(rows[2]).toEqual({ id: 'third', externalId: null });
    expect(() => db.prepare(`
      INSERT INTO stream VALUES
        ('new-duplicate', '2026-08-30T11:00:00Z', 'pocket', 'recording-1')
    `).run()).toThrow(/UNIQUE constraint failed/i);
    db.close();
  });
});
