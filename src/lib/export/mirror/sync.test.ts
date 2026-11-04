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

it('exports a link to a team record as its shared copy, or plain text with no title', async () => {
  home = await createTestHome({ prefix: 'ri-mirror-team-links-' });
  const q = await import('@/lib/db/queries');
  const { flushMirror } = await import('./sync');
  const { typeDir } = await import('./config');
  const { getDb } = await import('@/lib/db');
  const { teamConnections } = await import('@/lib/db/schema');
  const team = '01a1a3b3-1463-7fdc-a747-bc4860dc8e1d';
  getDb().insert(teamConnections).values({ id: team, name: 'Ball Coach', url: 'https://team.test', memberId: 'm1', memberName: 'Ada', role: 'member', status: 'active' }).run();
  const now = new Date().toISOString();
  const copy = q.saveTaskProjection({
    teamId: team, sourceTaskId: 'team-copied',
    fields: { title: 'Has a copy', description: null, body: 'Bare in team text [[task:team-copied]] and [[task:team-other]]', outcome: null, hardDeadline: null, status: 'todo' },
    source: { assigned: true, addedAt: null, bodyRevision: 1, statusChangedCount: 0, updatedAt: now, syncedAt: now, area: null, assignee: null },
    state: 'active',
  });
  const note = q.createNote({ title: 'Mine', body: `One [[task:${team}/team-copied]] two [[task:${team}/team-other]] three [[area:${team}/team-area]] four [[task:unknown-home/abc]]` });
  await flushMirror();

  const read = (type: 'task' | 'note', id: string) => {
    const file = fs.readdirSync(typeDir(type)).find(name => name.includes(id))!;
    return fs.readFileSync(path.join(typeDir(type), file), 'utf8');
  };
  const copyLink = `[[tasks/has-a-copy--${copy.id}]]`;
  expect(read('note', note.id)).toContain(`One ${copyLink} two Ball Coach task team-other three Ball Coach Area team-area four Team task abc`);
  expect(read('task', copy.id)).toContain(`Bare in team text ${copyLink} and Ball Coach task team-other`);
});
