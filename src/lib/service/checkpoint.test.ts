import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canonical } from './paths';
import { createCheckpoint, restoreCheckpointDatabase, verifyCheckpoint } from './checkpoint';
let root: string;
let dbFile: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-checkpoint-')); vi.stubEnv('RI_ROOT', path.join(root, 'home'));
  fs.mkdirSync(path.join(root, 'home/.config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'home/.work/unpublished'), { recursive: true });
  dbFile = path.join(root, 'home/data.db');
  const db = new Database(dbFile); db.exec("CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT); INSERT INTO notes VALUES(1, 'before');"); db.close();
  fs.writeFileSync(path.join(root, 'home/.config/key'), 'encrypted-secret-key');
  fs.writeFileSync(path.join(root, 'home/.work/unpublished/file'), 'uncommitted work');
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
it('verifies all files and restores only the database before activation', async () => {
  const profile = path.join(root, 'home/.config/electron-demo');
  fs.mkdirSync(profile); fs.writeFileSync(path.join(profile, 'live-draft'), 'latest browser draft');
  const checkpoint = await createCheckpoint(path.join(root, 'backup'));
  const manifest = verifyCheckpoint(checkpoint);
  expect(manifest.entries.map(entry => entry.source)).toContain(canonical(path.join(root, 'home/.config/key')));
  expect(manifest.entries.map(entry => entry.source)).toContain(canonical(path.join(root, 'home/.work/unpublished/file')));
  expect(manifest.entries.some(entry => entry.source.includes('/electron-demo/'))).toBe(false);
  const db = new Database(dbFile); db.exec("UPDATE notes SET body='candidate';"); db.close();
  fs.writeFileSync(path.join(root, 'home/.work/unpublished/file'), 'external edit');
  await restoreCheckpointDatabase(checkpoint);
  const restored = new Database(dbFile); expect(restored.prepare('SELECT body FROM notes').pluck().get()).toBe('before'); restored.close();
  expect(fs.readFileSync(path.join(root, 'home/.work/unpublished/file'), 'utf8')).toBe('external edit');
  expect(fs.readFileSync(path.join(profile, 'live-draft'), 'utf8')).toBe('latest browser draft');
  expect(fs.readdirSync(checkpoint).some(file => file.startsWith('failed-'))).toBe(true);
});
it('refuses a corrupt checkpoint without touching live data', async () => {
  const checkpoint = await createCheckpoint(path.join(root, 'backup'));
  fs.appendFileSync(path.join(checkpoint, 'database.sqlite'), 'corrupt');
  await expect(restoreCheckpointDatabase(checkpoint)).rejects.toThrow('checksum');
  const db = new Database(dbFile); expect(db.prepare('SELECT body FROM notes').pluck().get()).toBe('before'); db.close();
});
it('refuses recovery storage inside the data root', async () => {
  await expect(createCheckpoint(path.join(root, 'home/backup'))).rejects.toThrow('outside');
});
