import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { CreateTaskInput } from '@/db/types';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { PRIORITY_RANK_FILTER } from '@/lib/tasks/priority-rank';

vi.mock('@/lib/embeddings/embed', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/embeddings/embed')>(),
  upsertEmbedding: vi.fn(async () => {}),
}));
vi.mock('@/lib/sessions/workstream', () => ({ coordinateLifecycleChange: vi.fn(async () => {}) }));
vi.mock('@/lib/sessions/workstream-runtime', () => ({ inProcessWorkstreamRuntime: {} }));
vi.mock('@/lib/executor/status-snapshot', () => ({ listRunningSessions: () => [] }));
vi.setConfig({ testTimeout: 30_000 });

const STAMP = '2020-01-01T00:00:00.000Z';

describe('rankTask: a numbered spot in the Priority Order', () => {
  let home: TestHome;
  beforeEach(async () => {
    home = await createTestHome({ prefix: 'ri-rank-' });
    process.env.RI_MIRROR_DISABLED = '1';
  });
  afterEach(async () => {
    delete process.env.RI_MIRROR_DISABLED;
    await home.cleanup();
  });

  async function setup() {
    const q = await import('@/lib/db/queries');
    const { getDb } = await import('@/lib/db');
    const schema = await import('@/lib/db/schema');
    const db = getDb();
    function task(title: string, sortKey: string | null, extra: Partial<CreateTaskInput> = {}, createdAt?: string) {
      const row = q.createTask({ title, rawInput: title, ...extra });
      // Fixture keys and stamps, so the test can see exactly what a rank wrote.
      db.update(schema.tasks).set({ sortKey, updatedAt: STAMP, ...(createdAt ? { createdAt } : {}) })
        .where(eq(schema.tasks.id, row.id)).run();
      return row.id;
    }
    const order = () => q.listTasks(PRIORITY_RANK_FILTER).map((t) => t.title);
    const rows = () => new Map(db.select().from(schema.tasks).all().map((r) => [r.title, r]));
    return { q, task, order, rows };
  }

  it('moves only the task, across statuses and Areas, leaving every other row as it was', async () => {
    const { q, task, order, rows } = await setup();
    const area = q.createArea({ name: 'Work' });
    task('One', 'a0');
    task('Parked', 'a1', { status: 'consider' });
    task('Two', 'a2', { status: 'in_progress' });
    task('Finished', 'a3', { status: 'done' });
    task('Three', 'a4', { areaId: area.id });
    const four = task('Four', 'a5');
    const before = rows();

    expect(await q.rankTask(four, 2)).toEqual({ id: four, rank: 2, total: 4 });
    expect(order()).toEqual(['One', 'Four', 'Two', 'Three']);
    const after = rows();
    for (const [title, row] of before) {
      if (title === 'Four') continue;
      expect(after.get(title)).toEqual(row);
    }
    const moved = after.get('Four')!;
    expect(moved.sortKey! > 'a0' && moved.sortKey! < 'a2').toBe(true);
    expect(moved.updatedAt).not.toBe(STAMP);
    expect({ ...moved, sortKey: null, updatedAt: null }).toEqual({ ...before.get('Four')!, sortKey: null, updatedAt: null });
  });

  it('places past the end as last and below 1 is rejected', async () => {
    const { q, task, order } = await setup();
    const first = task('First', 'a0');
    task('Second', 'a1');
    expect(await q.rankTask(first, 50)).toMatchObject({ rank: 2, total: 2 });
    expect(order()).toEqual(['Second', 'First']);
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      await expect(q.rankTask(first, bad)).rejects.toMatchObject({ code: 'invalid_params' });
    }
  });

  it('is a no-op when the task is already there, timestamps included', async () => {
    const { q, task, rows } = await setup();
    task('Top', 'a0');
    const second = task('Second', 'a1');
    const before = rows();
    expect(await q.rankTask(second, 2)).toMatchObject({ rank: 2, total: 2 });
    expect(rows()).toEqual(before);
  });

  it('ranks an unranked task, keying only the unranked tasks above it', async () => {
    const { q, task, order, rows } = await setup();
    task('Ranked', 'a0');
    // Unranked tasks sit newest first.
    task('Old', null, {}, '2026-01-01T00:00:00.000Z');
    task('Middle', null, {}, '2026-01-02T00:00:00.000Z');
    const fresh = task('Newest', null, {}, '2026-01-03T00:00:00.000Z');
    expect(order()).toEqual(['Ranked', 'Newest', 'Middle', 'Old']);

    expect(await q.rankTask(fresh, 3)).toMatchObject({ rank: 3, total: 4 });
    expect(order()).toEqual(['Ranked', 'Middle', 'Newest', 'Old']);
    const after = rows();
    expect(after.get('Middle')!.sortKey).not.toBeNull();
    expect(after.get('Newest')!.sortKey).not.toBeNull();
    expect(after.get('Old')!.sortKey).toBeNull();
    expect(after.get('Old')!.updatedAt).toBe(STAMP);
  });

  it('settles ties the way the list shows them, and splits a tie at the requested spot', async () => {
    const { q, task, order } = await setup();
    const sameTime = '2026-02-01T00:00:00.000Z';
    task('A', 'a0');
    task('Tied 1', 'a1', {}, sameTime);
    task('Tied 2', 'a1', {}, sameTime);
    const last = task('Last', 'a2');
    const shown = order();
    expect(shown.slice(1, 3).sort()).toEqual(['Tied 1', 'Tied 2']);
    // Same key and created time: the id settles it, the same on every read.
    expect(order()).toEqual(shown);

    expect(await q.rankTask(last, 3)).toMatchObject({ rank: 3, total: 4 });
    expect(order()).toEqual(['A', shown[1], 'Last', shown[2]]);
  });

  it('refuses tasks outside committed work and missing tasks, changing nothing', async () => {
    const { q, task, rows } = await setup();
    task('Committed', 'a0');
    const parked = task('Parked', 'a1', { status: 'consider' });
    const before = rows();
    await expect(q.rankTask(parked, 1)).rejects.toMatchObject({ code: 'conflict' });
    await expect(q.rankTask('missing', 1)).rejects.toMatchObject({ code: 'not_found' });
    expect(rows()).toEqual(before);
  });

  it('is the tasks.rank procedure, with query refusals as tRPC errors', async () => {
    const { task, order } = await setup();
    const { appRouter } = await import('@/lib/trpc/router');
    const call = appRouter.createCaller({
      request: new Request('http://localhost/api/trpc'),
      key: { apiKeyId: 'viewer', scope: 'viewer', location: 'home', workerDeviceId: null, sessionChatId: null },
    });
    task('One', 'a0');
    const two = task('Two', 'a1');
    const parked = task('Parked', 'a2', { status: 'consider' });
    expect(await call.tasks.rank({ id: two, rank: 1 })).toEqual({ id: two, rank: 1, total: 2 });
    expect(order()).toEqual(['Two', 'One']);
    await expect(call.tasks.rank({ id: two, rank: 0 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(call.tasks.rank({ id: parked, rank: 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(call.tasks.rank({ id: 'missing', rank: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
