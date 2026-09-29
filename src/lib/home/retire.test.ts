/**
 * Retiring a home (docs/homes-spec.md §10.3, P5.2-P5.3): the stopped home's
 * database and identity are set aside in the folder with a note, nothing is
 * deleted, the worktrees stay, no new home starts there by habit, and it can
 * be undone.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

let home: TestHome;
let worktree: string;

beforeEach(async () => {
  process.env.RI_MIRROR_DISABLED = '1';
  home = await createTestHome({ prefix: 'ri-retire-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  identity.ensureHomeIdentity();
  const q = await import('@/lib/db/queries');
  q.createTask({ title: 'Something done here' });
  q.createWorkspace({ name: 'App', cwd: home.root, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
  worktree = path.join(home.root, '.work', 'worktrees', 'app', 'app-1');
  fs.mkdirSync(worktree, { recursive: true });
  fs.writeFileSync(path.join(worktree, 'unpushed.ts'), 'mine\n');
  // Stopped: nothing has the database open.
  (await import('@/lib/db')).resetDb();
  identity.resetHomeIdentityCache();
});

afterEach(async () => {
  delete process.env.RI_MIRROR_DISABLED;
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
});

it('sets the home aside with a note, keeps the worktrees, and refuses to start a new home there', async () => {
  const { retireHome, RetiredHomeError } = await import('./retire');
  const { getInstallationRole } = await import('@/lib/config/role');
  const done = retireHome({ successor: 'My Ri on the Mac Mini' });
  expect(done.retired).toMatchObject({ homeName: 'My Ri', successor: 'My Ri on the Mac Mini', counts: { tasks: 1, workspaces: 1 } });
  expect(done.retired.homeId).toMatch(/^[0-9a-f-]{36}$/);
  expect(fs.readdirSync(done.dir).sort()).toEqual(['data.db', 'machine.json', 'retired.json']);
  expect(fs.existsSync(home.dbPath)).toBe(false);
  expect(getInstallationRole()).toBe('fresh');
  // Nothing else moved.
  expect(fs.readFileSync(path.join(worktree, 'unpushed.ts'), 'utf8')).toBe('mine\n');
  // Starting Ri here by habit says what happened, rather than opening an empty home.
  const { getDb } = await import('@/lib/db');
  expect(() => getDb()).toThrow(RetiredHomeError);
  expect(() => getDb()).toThrow(/was retired on .*Its work now lives in My Ri on the Mac Mini\..*ri home retire --undo/);
  expect(fs.existsSync(home.dbPath)).toBe(false);
  // The kept database is whole on its own.
  const kept = new Database(path.join(done.dir, 'data.db'), { readonly: true });
  expect((kept.prepare('SELECT count(*) AS n FROM tasks').get() as { n: number }).n).toBe(1);
  kept.close();
});

it('brings the home back as it was', async () => {
  const { retireHome, undoRetire } = await import('./retire');
  const identity = await import('@/lib/home/identity');
  const before = (await import('@/lib/db/queries')).getHome()!.id;
  (await import('@/lib/db')).resetDb();
  retireHome();
  undoRetire();
  expect(fs.existsSync(path.join(home.root, '.retired'))).toBe(true);
  expect(fs.readdirSync(path.join(home.root, '.retired'))).toEqual([]);
  identity.resetHomeIdentityCache();
  expect(identity.ensureHomeIdentity().home.id).toBe(before);
  const q = await import('@/lib/db/queries');
  expect(q.listTasks({}).map((t) => t.title)).toEqual(['Something done here']);
});

it('refuses while anything has the database open, and in a folder with no home of its own', async () => {
  const { retireHome, undoRetire, RetireError } = await import('./retire');
  const { getDb, resetDb } = await import('@/lib/db');
  getDb();
  expect(() => retireHome()).toThrow(RetireError);
  expect(() => retireHome()).toThrow(/has .*data\.db open\. Stop it first/);
  resetDb();
  expect(() => undoRetire()).toThrow('This folder already has a home. Nothing was changed.');
  retireHome();
  expect(() => retireHome()).toThrow('This folder has no home to retire.');
  fs.writeFileSync(path.join(home.configDir, 'connection.json'), '{}');
  expect(() => undoRetire()).toThrow(/connected to a home elsewhere\. Disconnect it first/);
});

it('retires a home from before this version without changing its database', async () => {
  const { getDb, resetDb } = await import('@/lib/db');
  const raw = getDb() && (await import('@/lib/db')).getRawDb();
  raw.exec('DROP TABLE home');
  resetDb();
  fs.rmSync(path.join(home.configDir, 'machine.json'));
  const bytes = fs.statSync(home.dbPath).size;
  const { retireHome } = await import('./retire');
  const done = retireHome();
  expect(done.retired).toMatchObject({ homeId: null, homeName: 'My Ri', host: null });
  const kept = new Database(path.join(done.dir, 'data.db'), { readonly: true });
  expect(kept.prepare("SELECT name FROM sqlite_master WHERE name = 'home'").get()).toBeUndefined();
  kept.close();
  expect(fs.statSync(path.join(done.dir, 'data.db')).size).toBeGreaterThanOrEqual(bytes);
});
