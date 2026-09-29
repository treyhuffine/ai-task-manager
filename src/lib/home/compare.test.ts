/**
 * Comparing two homes before consolidating them (P5.1): one begun as a copy
 * of the other, then each changed on its own. Neither is written to.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

let home: TestHome;
let copyRoot: string;
let ids: { kept: string; changedInCopy: string; changedAtHome: string; note: string; area: string };

beforeEach(async () => {
  // The markdown mirror isn't compared, and writes after the folders are gone.
  process.env.RI_MIRROR_DISABLED = '1';
  home = await createTestHome({ prefix: 'ri-compare-a-' });
  const q = await import('@/lib/db/queries');
  const area = q.createArea({ name: 'Work' });
  const kept = q.createTask({ title: 'Kept as it was', areaId: area.id });
  const changedInCopy = q.createTask({ title: 'Changed on the laptop' });
  const changedAtHome = q.createTask({ title: 'Changed on the Mini' });
  const note = q.createNote({ title: 'Shared note', body: 'Both have this.' });
  ids = { kept: kept.id, changedInCopy: changedInCopy.id, changedAtHome: changedAtHome.id, note: note.id, area: area.id };
  fs.mkdirSync(path.join(home.root, 'attachments'), { recursive: true });
  fs.writeFileSync(path.join(home.root, 'attachments', 'both.png'), 'same');
  fs.writeFileSync(path.join(home.root, 'MEMORY.md'), '# Memory\n');
  (await import('@/lib/db')).resetDb();

  // The laptop's home, begun as a copy.
  copyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-compare-b-'));
  fs.cpSync(home.root, copyRoot, { recursive: true });
  const b = new Database(path.join(copyRoot, 'data.db'));
  b.prepare("UPDATE tasks SET title = 'Changed on the laptop, later', updated_at = '2099-01-01T00:00:00.000Z' WHERE id = ?").run(ids.changedInCopy);
  // A task only the laptop has, and one made again there that the Mini already has.
  const clone = (from: string, id: string, title: string) => {
    const row = b.prepare('SELECT * FROM tasks WHERE id = ?').get(from) as Record<string, unknown>;
    const cols = Object.keys(row);
    b.prepare(`INSERT INTO tasks (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(
      ...cols.map((c) => (c === 'id' ? id : c === 'title' ? title : row[c])),
    );
  };
  clone(ids.kept, '01a0ffff-0000-7000-8000-000000000001', 'Only on the laptop');
  clone(ids.kept, '01a0ffff-0000-7000-8000-000000000002', 'kept  as it WAS');
  b.close();
  fs.writeFileSync(path.join(copyRoot, 'attachments', 'laptop-only.pdf'), 'new');
  fs.writeFileSync(path.join(copyRoot, 'MEMORY.md'), '# Memory\n\nLearned on the laptop.\n');

  // And the Mini changes one of its own after the copy.
  const a = new Database(path.join(home.root, 'data.db'));
  a.prepare("UPDATE tasks SET updated_at = '2099-02-01T00:00:00.000Z' WHERE id = ?").run(ids.changedAtHome);
  a.close();
});

afterEach(async () => {
  delete process.env.RI_MIRROR_DISABLED;
  fs.rmSync(copyRoot, { recursive: true, force: true });
  await home.cleanup();
});

it('says what the laptop has that the Mini lacks, what it changed later, and what it made again', async () => {
  const { compareHomes } = await import('./compare');
  const before = fs.readdirSync(home.root).sort();
  const c = compareHomes(home.root, copyRoot);
  const tasks = c.kinds.find((k) => k.kind === 'tasks')!;
  expect(tasks.counts).toEqual({ a: 3, b: 5 });
  expect(tasks.inBoth.unchanged).toBe(1);
  expect(tasks.inBoth.newerInB.map((r) => r.title)).toEqual(['Changed on the laptop, later']);
  expect(tasks.inBoth.newerInA.map((r) => r.id)).toEqual([ids.changedAtHome]);
  expect(tasks.onlyInB.map((r) => r.title).sort()).toEqual(['Only on the laptop', 'kept  as it WAS']);
  // Made again, with another id: alike by title, whatever its spacing and case.
  expect(tasks.onlyInBLikeA).toEqual([]);
  expect(c.kinds.find((k) => k.kind === 'notes')!.inBoth.unchanged).toBe(1);
  expect(c.kinds.find((k) => k.kind === 'areas')!.inBoth.unchanged).toBe(1);
  expect(c.sharedIdShare).toBeGreaterThan(0.5);
  expect(c.attachments).toMatchObject({ same: 1, onlyInB: ['laptop-only.pdf'], onlyInA: [], differ: [] });
  expect(c.persona).toMatchObject({ differ: ['MEMORY.md'] });
  // Neither home was written to.
  expect(fs.readdirSync(home.root).sort()).toEqual(before);
  expect(fs.existsSync(path.join(copyRoot, 'data.db-wal'))).toBe(false);
});

it('finds a record made on each side under its own id, by what it says', async () => {
  const b = new Database(path.join(copyRoot, 'data.db'));
  b.prepare('DELETE FROM tasks WHERE id = ?').run(ids.kept);
  b.close();
  const { compareHomes, describeComparison } = await import('./compare');
  const c = compareHomes(home.root, copyRoot);
  const tasks = c.kinds.find((k) => k.kind === 'tasks')!;
  expect(tasks.onlyInA.map((r) => r.id)).toEqual([ids.kept]);
  expect(tasks.onlyInBLikeA).toEqual([{ b: expect.objectContaining({ title: 'kept  as it WAS' }), a: expect.objectContaining({ id: ids.kept }) }]);
  const text = describeComparison(c, { names: { a: 'Mini', b: 'Laptop' } });
  expect(text).toContain('tasks in Laptop that Mini lacks:');
  expect(text).toContain('+ Only on the laptop');
  expect(text).toContain(`looks like Mini's ${ids.kept}`);
  expect(text).toContain('↑ Changed on the laptop, later');
});

it('compares homes on different schemas by the columns both have', async () => {
  const b = new Database(path.join(copyRoot, 'data.db'));
  b.exec('DROP TABLE IF EXISTS folder_links');
  b.exec('ALTER TABLE tasks DROP COLUMN outcome');
  b.exec('DROP TABLE reference_folders');
  b.close();
  const { compareHomes } = await import('./compare');
  const c = compareHomes(home.root, copyRoot);
  expect(c.kinds.find((k) => k.kind === 'tasks')!.counts.b).toBe(5);
  expect(c.kinds.find((k) => k.kind === 'linked folders')!.counts).toEqual({ a: 0, b: null });
});
