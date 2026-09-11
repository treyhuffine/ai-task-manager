import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { APP_SHORT_ID } from '@/constants/app';
import type { CreateTaskInput } from '@/db/types';

vi.mock('@/lib/embeddings/embed', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/embeddings/embed')>(),
  upsertEmbedding: vi.fn(async () => {}),
}));
vi.setConfig({ testTimeout: 30_000 });

describe('selected-only Area task ordering', () => {
  let tmpDir: string;
  const prefix = APP_SHORT_ID.toUpperCase();
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-query-reorder-'));
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

  async function setup() {
    const q = await import('@/lib/db/queries');
    const { getDb, getRawDb } = await import('@/lib/db');
    const schema = await import('@/lib/db/schema');
    const area = q.createArea({ name: 'Selected Area' });
    const otherArea = q.createArea({ name: 'Other Area' });
    function task(title: string, sortKey: string | null, extra: Partial<CreateTaskInput> = {}) {
      const row = q.createTask({ title, areaId: area.id, body: `Original ${title}\n\nKeep my exact thinking.`, ...extra });
      // Fixture-only legacy values and stable timestamps make preservation
      // checks cover nulls, duplicates, arbitrary bounds and timestamp replay.
      getDb().update(schema.tasks).set({ sortKey, updatedAt: '2020-01-01T00:00:00.000Z' })
        .where(eq(schema.tasks.id, row.id)).run();
      return q.getTask(row.id)!;
    }
    function snapshot() {
      return getDb().select().from(schema.tasks).orderBy(schema.tasks.id).all();
    }
    return { q, area, otherArea, task, snapshot, db: getDb(), raw: getRawDb(), schema };
  }

  it('promotes an ordered mixed-status selection, preserving all other rows and selected content', async () => {
    const { q, area, otherArea, task, snapshot, db, schema } = await setup();
    const parent = task('First remaining', 'a0', { status: 'done' });
    const todo = task('Todo selection', null, {
      contextTags: ['original'], effort: 'medium', userContext: 'Keep this too',
      parentId: parent.id, hardDeadline: '2027-01-01T00:00:00.000Z',
      body: 'Original wording\n\n![Original screenshot](/api/attachments/selected.png)',
      attachments: [{
        fileName: 'selected.png', originalName: 'Original screenshot.png', mimeType: 'image/png',
        size: 42, uploadedAt: '2020-01-01T00:00:00.000Z',
      }],
    });
    task('Second remaining', 'a2');
    const consider = task('Consider selection', 'a5', { status: 'consider' });
    const inProgress = task('In progress selection', 'a4', { status: 'in_progress' });
    task('Other Area first', 'Zz', { areaId: otherArea.id });
    task('No Area', 'Zy', { areaId: null });
    const before = snapshot();
    expect(todo.attachments).toHaveLength(1);
    const taskIds = [consider.id, todo.id, inProgress.id];
    const selectedIds = new Set(taskIds);
    const ledgerBefore = db.select().from(schema.taskStatusChanges).all();
    const { upsertEmbedding } = await import('@/lib/embeddings/embed');
    vi.mocked(upsertEmbedding).mockClear();

    expect(await q.reorderTasksToTop({ areaId: area.id, taskIds })).toEqual({
      areaId: area.id, position: 'top', taskIds, changedTaskIds: taskIds,
    });
    const ordered = q.listTasks({ areaId: area.id, orderBy: 'sortKey' });
    expect(ordered.slice(0, 3).map((t) => t.id)).toEqual(taskIds);
    const after = snapshot();
    expect(after.filter((t) => !selectedIds.has(t.id))).toEqual(before.filter((t) => !selectedIds.has(t.id)));
    for (const original of before.filter((t) => selectedIds.has(t.id))) {
      const current = after.find((t) => t.id === original.id)!;
      expect({ ...current, sortKey: original.sortKey, updatedAt: original.updatedAt }).toEqual(original);
      expect(current.updatedAt).not.toBe(original.updatedAt);
      expect(q.listEntityVersions('task', original.id)).toHaveLength(0);
    }
    expect(db.select().from(schema.taskStatusChanges).all()).toEqual(ledgerBefore);
    expect(upsertEmbedding).not.toHaveBeenCalled();
  });

  it('preserves duplicate and null unselected keys, including archived siblings', async () => {
    const { q, area, task, snapshot } = await setup();
    task('Archived earliest', 'Zz', { status: 'archived' });
    task('Duplicate 1', 'a0');
    task('Duplicate 2', 'a0');
    task('Null 1', null);
    task('Null 2', null);
    const b = task('Selected b', null);
    const a = task('Selected a', 'a0');
    const before = snapshot();
    await q.reorderTasksToTop({ areaId: area.id, taskIds: [a.id, b.id] });
    expect(q.listTasks({ areaId: area.id }).slice(0, 2).map((t) => t.id)).toEqual([a.id, b.id]);
    expect(q.getTask(b.id)!.sortKey! < 'Zz').toBe(true);
    expect(snapshot().filter((t) => t.id !== a.id && t.id !== b.id))
      .toEqual(before.filter((t) => t.id !== a.id && t.id !== b.id));
  });

  it('handles a remaining queue with only null keys', async () => {
    const { q, area, task } = await setup();
    const a = task('First', null);
    const b = task('Second', null);
    const c = task('Third', null);
    const existing = q.listTasks({ areaId: area.id });
    const selected = existing.at(-1)!;
    await q.reorderTasksToTop({ areaId: area.id, taskIds: [selected.id] });
    expect(q.listTasks({ areaId: area.id })[0].id).toBe(selected.id);
    for (const row of [a, b, c].filter((t) => t.id !== selected.id)) expect(q.getTask(row.id)).toEqual(row);
  });

  it('can order the whole Area and retry without changing timestamps or keys', async () => {
    const { q, area, task, snapshot } = await setup();
    const a = task('First', 'a0');
    const b = task('Second', 'a1');
    const c = task('Third', null);
    const input = { areaId: area.id, taskIds: [c.id, a.id, b.id] };
    await q.reorderTasksToTop(input);
    const after = snapshot();
    expect(q.listTasks({ areaId: area.id }).map((t) => t.id)).toEqual(input.taskIds);
    expect(await q.reorderTasksToTop(input)).toEqual({ ...input, position: 'top', changedTaskIds: [] });
    expect(snapshot()).toEqual(after);
  });

  it('is a no-op when the requested prefix is already first', async () => {
    const { q, area, task, snapshot } = await setup();
    const a = task('First', 'a0');
    const b = task('Second', 'a1');
    task('Rest', null);
    const before = snapshot();
    expect((await q.reorderTasksToTop({ areaId: area.id, taskIds: [a.id, b.id] })).changedTaskIds).toEqual([]);
    expect(snapshot()).toEqual(before);
  });

  it.each(['empty', 'duplicate', 'blank', 'oversize', 'missing-task', 'missing-area', 'wrong-area', 'null-area'] as const)
    ('rejects %s atomically', async (scenario) => {
      const { q, area, otherArea, task, snapshot } = await setup();
      task('Remaining', 'a0');
      const selected = task('Selected', 'a2');
      const other = task('Wrong Area', 'a1', { areaId: otherArea.id });
      const noArea = task('No Area', 'a1', { areaId: null });
      const taskIds = scenario === 'empty' ? []
        : scenario === 'duplicate' ? [selected.id, selected.id]
        : scenario === 'blank' ? [selected.id, ' ']
        : scenario === 'oversize' ? Array.from({ length: q.MAX_REORDER_TASKS + 1 }, (_, i) => `id-${i}`)
        : scenario === 'missing-task' ? [selected.id, 'missing']
        : scenario === 'wrong-area' ? [selected.id, other.id]
        : scenario === 'null-area' ? [selected.id, noArea.id]
        : [selected.id];
      const areaId = scenario === 'missing-area' ? 'missing-area' : area.id;
      const code = scenario.startsWith('missing') ? 'not_found'
        : scenario.endsWith('area') ? 'conflict' : 'invalid_params';
      const before = snapshot();
      await expect(q.reorderTasksToTop({ areaId, taskIds })).rejects.toMatchObject({ code });
      expect(snapshot()).toEqual(before);
    });

  it.each(['!invalid', 'a!', 'a?', 'a_', 'Z!'])('rejects invalid unselected bound %s without changing any row', async (bound) => {
    const { q, area, task, snapshot } = await setup();
    task('Malformed legacy bound', bound);
    const selected = task('Selected', null);
    const before = snapshot();
    await expect(q.reorderTasksToTop({ areaId: area.id, taskIds: [selected.id] }))
      .rejects.toMatchObject({ code: 'conflict' });
    expect(snapshot()).toEqual(before);
  });

  it('rolls back the entire selection if a database write fails mid-batch', async () => {
    const { q, area, task, snapshot, raw } = await setup();
    task('Remaining', 'a0');
    const a = task('Selected a', 'a1');
    const b = task('Selected b', 'a2');
    // SQLite fixture trigger simulates an actual storage error after the first
    // selected row was written. No mock can prove transaction rollback here.
    raw.exec(`CREATE TRIGGER fail_reorder_fixture BEFORE UPDATE OF sort_key ON tasks
      WHEN OLD.id = '${b.id}' BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END`);
    const before = snapshot();
    await expect(q.reorderTasksToTop({ areaId: area.id, taskIds: [a.id, b.id] })).rejects.toThrow('fixture write failure');
    expect(snapshot()).toEqual(before);
  });

  it('refreshes changed mirrors after commit without touching unselected mirrors', async () => {
    const { q, area, task } = await setup();
    const remaining = task('Remaining', 'a0');
    const selected = task('Selected', 'a1');
    vi.stubEnv(`${prefix}_MIRROR_DISABLED`, '0');
    await q.reorderTasksToTop({ areaId: area.id, taskIds: [selected.id] });
    const { findByIdInType } = await import('@/lib/export/mirror/fs');
    const [mirror] = await findByIdInType('task', selected.id);
    const rendered = fs.readFileSync(mirror, 'utf8');
    expect(rendered).toContain(q.getTask(selected.id)!.updatedAt);
    expect(rendered).toContain(selected.body);
    expect(await findByIdInType('task', remaining.id)).toHaveLength(0);
  });

  it('deduplicates shared backlink mirror cascades in one batch', async () => {
    const { q, area, task, snapshot } = await setup();
    task('Remaining', 'a0');
    const a = task('Selected a', 'a1');
    const b = task('Selected b', 'a2');
    const shared = q.createNote({ title: 'Shared guide', body: `[[task:${a.id}]]\n\n[[task:${b.id}]]`, areaId: area.id });
    const before = snapshot();
    const mirrorFs = await import('@/lib/export/mirror/fs');
    const write = vi.spyOn(mirrorFs, 'writeEntityFile');
    const warn = vi.spyOn(console, 'warn');
    try {
      vi.stubEnv(`${prefix}_MIRROR_DISABLED`, '0');
      await q.reorderTasksToTop({ areaId: area.id, taskIds: [b.id, a.id] });
      expect(write.mock.calls.filter(([type, id]) => type === 'note' && id === shared.id)).toHaveLength(1);
      expect(warn).not.toHaveBeenCalled();
      expect(q.getNote(shared.id)).toEqual(shared);
      expect(snapshot().filter((t) => t.id !== a.id && t.id !== b.id))
        .toEqual(before.filter((t) => t.id !== a.id && t.id !== b.id));
    } finally {
      write.mockRestore();
      warn.mockRestore();
    }
  });
});
