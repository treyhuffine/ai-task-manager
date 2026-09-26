/**
 * One worker per root (P2.7 to P2.9 re-check): the lock is refused while its
 * holder is still that process, and taken over once it's gone.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { acquireWorkerLock, WorkerLockedError } from './lock';

let dir: string;
let lockFile: string;

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-worker-lock-')));
  lockFile = path.join(dir, 'work', 'worker.lock');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

it('refuses a second worker while the first holds the lock, and lets one in once it is released', async () => {
  const first = await acquireWorkerLock(lockFile);
  await expect(acquireWorkerLock(lockFile)).rejects.toBeInstanceOf(WorkerLockedError);
  first.release();
  const next = await acquireWorkerLock(lockFile);
  next.release();
  expect(fs.existsSync(lockFile)).toBe(false);
});

it('takes over a lock whose holder is gone, or is now a different process under the same pid', async () => {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, JSON.stringify({ pid: 999_999, ppid: 1, started: 'Mon Jan 1 00:00:00 2001', command: 'ri worker run', token: 'gone' }));
  const taken = await acquireWorkerLock(lockFile);
  taken.release();

  // A pid in use, but by a process that started at another time.
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.ppid, ppid: 1, started: 'Mon Jan 1 00:00:00 2001', command: 'ri worker run', token: 'reused' }));
  const again = await acquireWorkerLock(lockFile);
  again.release();
});

it("doesn't release a lock that has passed to another worker", async () => {
  const first = await acquireWorkerLock(lockFile);
  const holder = fs.readFileSync(lockFile, 'utf8');
  fs.writeFileSync(lockFile, holder.replace(/"token":"[^"]+"/, '"token":"someone-else"'));
  first.release();
  expect(fs.readFileSync(lockFile, 'utf8')).toContain('someone-else');
});

it('stops a worker before it opens anything when another holds the root', async () => {
  const held = await acquireWorkerLock(lockFile);
  const { runWorker } = await import('./run');
  const exit = await runWorker({
    target: { homeUrl: 'http://127.0.0.1:9', homeId: 'home', homeName: 'Home', computerId: 'c', computerName: 'Laptop', workerKey: 'k' } as never,
    version: 'test',
    lockFile,
    processRecordFile: path.join(dir, 'work', 'worker-processes.json'),
  });
  expect(exit).toMatchObject({ reason: 'already_running' });
  expect(fs.existsSync(path.join(dir, 'work', 'worker-processes.json'))).toBe(false);
  held.release();
});
