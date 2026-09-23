/**
 * Area changes are part of task and note history, so an agent that moves an
 * item between areas (the heartbeat's default instructions do) can be undone
 * like any other edit. Older snapshots predate the field and must never be
 * read as "no area".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { APP_SHORT_ID } from '@/constants/app';

vi.mock('@/lib/embeddings/embed', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/embeddings/embed')>(),
  upsertEmbedding: vi.fn(async () => {}),
}));
vi.setConfig({ testTimeout: 30_000 });

describe('area in task and note history', () => {
  let tmpDir: string;
  const prefix = APP_SHORT_ID.toUpperCase();
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-area-versions-'));
    vi.stubEnv(`${prefix}_ROOT`, tmpDir);
    vi.stubEnv(`${prefix}_DB_PATH`, path.join(tmpDir, 'data.db'));
    vi.stubEnv(`${prefix}_MIRROR_DISABLED`, '1');
    vi.resetModules();
  });
  afterEach(async () => {
    const { resetDb } = await import('@/lib/db');
    resetDb();
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('an agent setting a task area records a version, and reverting it clears the area again', async () => {
    const q = await import('@/lib/db/queries');
    const area = q.createArea({ name: 'Ri Product' });
    const task = q.createTask({ title: 'Needs an area' });

    q.updateTask(task.id, { areaId: area.id }, { source: 'ai' });
    const versions = q.listEntityVersions('task', task.id);
    // Seeded baseline (no area) plus the agent's edit.
    expect(versions.map((v) => [v.source, v.snapshot.areaId])).toEqual(
      expect.arrayContaining([['human', null], ['ai', area.id]]),
    );

    const baseline = versions.find((v) => v.source === 'human')!;
    const reverted = q.revertEntityTo(baseline.id)!;
    expect((reverted.record as { areaId: string | null }).areaId).toBeNull();
  });

  it('an area-only change is enough to record a version', async () => {
    const q = await import('@/lib/db/queries');
    const a = q.createArea({ name: 'A' });
    const b = q.createArea({ name: 'B' });
    const task = q.createTask({ title: 'Moves', areaId: a.id });
    q.updateTask(task.id, { areaId: b.id }, { source: 'ai' });
    expect(q.listEntityVersions('task', task.id).length).toBeGreaterThan(0);
  });

  it('reverting to a snapshot from before area history leaves the current area alone', async () => {
    const q = await import('@/lib/db/queries');
    const { getDb } = await import('@/lib/db');
    const schema = await import('@/lib/db/schema');
    const area = q.createArea({ name: 'Keep me' });
    const task = q.createTask({ title: 'Old title', areaId: area.id });
    q.updateTask(task.id, { title: 'New title' }, { source: 'human' });

    // Make the baseline look like it was written before areas were recorded.
    const baseline = q.listEntityVersions('task', task.id).find((v) => v.snapshot.title === 'Old title')!;
    const legacy = { ...baseline.snapshot };
    delete legacy.areaId;
    getDb().update(schema.entityVersions).set({ snapshot: legacy }).where(eq(schema.entityVersions.id, baseline.id)).run();

    const reverted = q.revertEntityTo(baseline.id)!;
    expect(reverted.record).toMatchObject({ title: 'Old title', areaId: area.id });
  });

  it('reverting to an area that no longer exists leaves the current area alone', async () => {
    const q = await import('@/lib/db/queries');
    const { getDb } = await import('@/lib/db');
    const schema = await import('@/lib/db/schema');
    const gone = q.createArea({ name: 'Gone' });
    const current = q.createArea({ name: 'Current' });
    const task = q.createTask({ title: 'T', areaId: gone.id });
    q.updateTask(task.id, { areaId: current.id }, { source: 'ai' });
    const withGone = q.listEntityVersions('task', task.id).find((v) => v.snapshot.areaId === gone.id)!;
    getDb().delete(schema.areas).where(eq(schema.areas.id, gone.id)).run();

    const reverted = q.revertEntityTo(withGone.id)!;
    expect((reverted.record as { areaId: string | null }).areaId).toBe(current.id);
  });

  it('note area changes are recorded and revertible too', async () => {
    const q = await import('@/lib/db/queries');
    const area = q.createArea({ name: 'Notes home' });
    const note = q.createNote({ title: 'A note', body: 'x' });
    q.updateNote(note.id, { areaId: area.id }, { source: 'ai' });
    const baseline = q.listEntityVersions('note', note.id).find((v) => v.source === 'human')!;
    expect(baseline.snapshot.areaId).toBeNull();
    const reverted = q.revertEntityTo(baseline.id)!;
    expect((reverted.record as { areaId: string | null }).areaId).toBeNull();
  });
});
