import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWorkerCheckpoint, verifyWorkerCheckpoint } from './worker-checkpoint';
let root: string;
let home: string;
let recovery: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-worker-checkpoint-')); home = path.join(root, 'device'); recovery = path.join(root, 'recovery');
  fs.mkdirSync(path.join(home, '.config'), { recursive: true }); fs.mkdirSync(path.join(home, 'work/journal'), { recursive: true });
  vi.stubEnv('RI_ROOT', home); for (const name of ['RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR']) vi.stubEnv(name, undefined);
  fs.writeFileSync(path.join(home, '.config/connection.json'), '{"credential":"private"}');
  fs.writeFileSync(path.join(home, 'work/journal/home.jsonl'), '{"position":1}\n');
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
it('checkpoints local configuration and durable journals without creating or opening a database', () => {
  createWorkerCheckpoint(recovery);
  const verified = verifyWorkerCheckpoint(recovery);
  expect(verified.kind).toBe('worker');
  expect(verified.entries.map(e => e.source)).toContain(fs.realpathSync(path.join(home, 'work/journal/home.jsonl')));
  expect(fs.existsSync(path.join(home, 'data.db'))).toBe(false);
  expect(fs.existsSync(path.join(recovery, 'database.sqlite'))).toBe(false);
});
it('preserves newer journal positions during validation recovery', () => {
  createWorkerCheckpoint(recovery);
  const journal = path.join(home, 'work/journal/home.jsonl');
  fs.appendFileSync(journal, '{"position":2}\n');
  verifyWorkerCheckpoint(recovery);
  expect(fs.readFileSync(journal, 'utf8')).toContain('"position":2');
});
it('refuses a database appearing in a connected installation and a changed checkpoint', () => {
  createWorkerCheckpoint(recovery);
  fs.writeFileSync(path.join(home, 'data.db'), 'never open');
  expect(() => verifyWorkerCheckpoint(recovery)).toThrow('database appeared');
  fs.rmSync(path.join(home, 'data.db'));
  const manifest = verifyWorkerCheckpoint(recovery);
  fs.appendFileSync(path.join(recovery, manifest.entries[0].saved), 'changed');
  expect(() => verifyWorkerCheckpoint(recovery)).toThrow('checksum');
});
it('excludes the live browser profile and does not follow project links', () => {
  const outside = path.join(root, 'project'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'unrelated.txt'), 'untouched');
  fs.symlinkSync(outside, path.join(home, 'linked-project'));
  fs.mkdirSync(path.join(home, '.config/electron-demo')); fs.writeFileSync(path.join(home, '.config/electron-demo/live.db'), 'open');
  const manifest = verifyWorkerCheckpoint(createWorkerCheckpoint(recovery));
  expect(manifest.entries.some(e => e.source.includes('live.db'))).toBe(false);
  expect(manifest.entries.find(e => e.source.endsWith('linked-project'))?.link).toBe(outside);
  expect(manifest.entries.some(e => e.source.includes('unrelated.txt'))).toBe(false);
});
