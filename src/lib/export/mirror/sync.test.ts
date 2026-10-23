/**
 * Overlapping syncs of one entity: each reads the row when it runs, so they
 * run one after another, and the file ends with the newest content. Before,
 * they shared one temp file and ran in parallel: one failed its rename, and
 * an older one could finish last.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

let home: TestHome | null = null;
afterEach(async () => {
  await home?.cleanup();
  vi.restoreAllMocks();
  home = null;
});

it('drains deferred projections before deleting a disposable Home', async () => {
  home = await createTestHome({ prefix: 'ri-mirror-drain-' });
  const q = await import('@/lib/db/queries');
  const { flushMirror } = await import('./sync');
  const warn = vi.spyOn(console, 'warn');
  const task = q.createTask({ title: 'Pending projection' });
  q.updateTask(task.id, { title: 'Last acknowledged edit' }, { source: 'human' });
  await flushMirror();
  const { typeDir } = await import('./config');
  const file = fs.readdirSync(typeDir('task')).find(name => name.includes(task.id))!;
  expect(fs.readFileSync(path.join(typeDir('task'), file), 'utf8')).toContain('Last acknowledged edit');
  const root = home.root;
  await home.cleanup(); home = null;
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(fs.existsSync(root)).toBe(false);
  expect(warn).not.toHaveBeenCalled();
});

it('keeps the newest content when syncs of one entity overlap', async () => {
  home = await createTestHome({ prefix: 'ri-mirror-sync-' });
  const q = await import('@/lib/db/queries');
  const { syncEntity } = await import('./sync');
  const { typeDir } = await import('./config');
  const warn = vi.spyOn(console, 'warn');

  const task = q.createTask({ title: 'Version 0' });
  const syncs: Promise<void>[] = [];
  for (let n = 1; n <= 8; n++) {
    q.updateTask(task.id, { title: `Version ${n}` }, { source: 'human' });
    syncs.push(syncEntity('task', task.id));
  }
  await Promise.all(syncs);
  // And once more, after anything the updates scheduled themselves.
  await syncEntity('task', task.id);

  const dir = typeDir('task');
  const files = fs.readdirSync(dir).filter((f) => f.includes(task.id));
  expect(files).toHaveLength(1);
  expect(fs.readFileSync(path.join(dir, files[0]!), 'utf8')).toContain('Version 8');
  expect(fs.readdirSync(path.join(dir, '.tmp'))).toEqual([]);
  expect(warn.mock.calls.filter(([message]) => String(message).startsWith('[mirror]'))).toEqual([]);
});
