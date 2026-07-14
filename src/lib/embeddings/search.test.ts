import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  generateEmbedding: vi.fn(),
}));

vi.mock('./embed', () => ({
  generateEmbedding: mocks.generateEmbedding,
}));

const ENV_KEYS = ['FLOW_ROOT', 'FLOW_DB_PATH', 'FLOW_MIRROR_DISABLED'] as const;

function unitVector(dimension: number): Float32Array {
  const vector = new Float32Array(1536);
  vector[dimension] = 1;
  return vector;
}

describe('vector search', () => {
  let root: string;
  let savedEnv: Record<(typeof ENV_KEYS)[number], string | undefined>;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-vector-search-'));
    savedEnv = {
      FLOW_ROOT: process.env.FLOW_ROOT,
      FLOW_DB_PATH: process.env.FLOW_DB_PATH,
      FLOW_MIRROR_DISABLED: process.env.FLOW_MIRROR_DISABLED,
    };
    process.env.FLOW_ROOT = path.join(root, 'flow-root');
    process.env.FLOW_DB_PATH = path.join(root, 'flow.db');
    process.env.FLOW_MIRROR_DISABLED = '1';
    mocks.generateEmbedding.mockReset();
    vi.resetModules();
  });

  afterEach(async () => {
    const { resetDb } = await import('@/lib/db');
    resetDb();
    for (const key of ENV_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
    vi.resetModules();
  });

  async function insertEmbedding(
    entityType: 'task' | 'note' | 'stream',
    entityId: string,
    vector: Float32Array,
  ): Promise<number> {
    const { getRawDb } = await import('@/lib/db');
    const db = getRawDb();
    const result = db
      .prepare(
        `INSERT INTO embeddings(entity_type, entity_id, content_hash, text_content)
         VALUES (?, ?, ?, ?)`,
      )
      .run(entityType, entityId, `hash-${entityId}`, `content-${entityId}`);
    const rowid = Number(result.lastInsertRowid);
    db.prepare('INSERT INTO embeddings_vec(rowid, embedding) VALUES (?, ?)').run(
      BigInt(rowid),
      vector,
    );
    return rowid;
  }

  it('runs joined KNN search with k and returns cosine similarity scores', async () => {
    const queryVector = unitVector(0);
    await insertEmbedding('task', 'exact-match', queryVector);
    await insertEmbedding('note', 'orthogonal-match', unitVector(1));
    mocks.generateEmbedding.mockResolvedValue(Array.from(queryVector));

    const { vectorSearch } = await import('./search');
    const limitedHits = await vectorSearch('find the exact match', 1);
    const hits = await vectorSearch('find the exact match', 2);

    expect(limitedHits).toEqual([{ entityType: 'task', entityId: 'exact-match', score: 1 }]);
    expect(mocks.generateEmbedding).toHaveBeenCalledTimes(2);
    expect(mocks.generateEmbedding).toHaveBeenLastCalledWith('find the exact match');
    expect(hits).toEqual([
      { entityType: 'task', entityId: 'exact-match', score: 1 },
      { entityType: 'note', entityId: 'orthogonal-match', score: 0 },
    ]);
  });

  it('upgrades an existing L2 vec0 table to cosine without losing vectors', async () => {
    const firstRowid = await insertEmbedding('task', 'first', unitVector(0));
    const secondRowid = await insertEmbedding('note', 'second', unitVector(1));
    const dbModule = await import('@/lib/db');
    const db = dbModule.getRawDb();

    // Recreate the pre-fix table shape to exercise the real startup upgrade.
    db.transaction(() => {
      db.exec(`
        CREATE TEMP TABLE legacy_embeddings_vec AS
        SELECT rowid, embedding FROM embeddings_vec;

        DROP TABLE embeddings_vec;
        CREATE VIRTUAL TABLE embeddings_vec USING vec0(embedding float[1536]);

        INSERT INTO embeddings_vec(rowid, embedding)
        SELECT rowid, embedding FROM legacy_embeddings_vec;

        DROP TABLE legacy_embeddings_vec;
      `);
    })();

    const legacySql = db
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'embeddings_vec'")
      .pluck()
      .get() as string;
    expect(legacySql).not.toContain('distance_metric=cosine');

    dbModule.resetDb();
    const migrated = dbModule.getRawDb();
    const migratedSql = migrated
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'embeddings_vec'")
      .pluck()
      .get() as string;
    expect(migratedSql).toContain('distance_metric=cosine');

    const matches = migrated
      .prepare(
        `SELECT rowid, distance
         FROM embeddings_vec
         WHERE embedding MATCH ? AND k = ?
         ORDER BY distance`,
      )
      .all(unitVector(0), 2) as Array<{ rowid: number; distance: number }>;
    expect(matches.map((match) => match.rowid).sort((a, b) => a - b)).toEqual([
      firstRowid,
      secondRowid,
    ]);
    expect(matches[0]?.distance).toBeCloseTo(0);
    expect(matches[1]?.distance).toBeCloseTo(1);

    // A second startup is a no-op and leaves the migrated index intact.
    dbModule.resetDb();
    const reopened = dbModule.getRawDb();
    const vectorCount = reopened.prepare('SELECT COUNT(*) FROM embeddings_vec').pluck().get();
    expect(vectorCount).toBe(2);
  });
});
