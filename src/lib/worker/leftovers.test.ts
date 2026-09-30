/**
 * A restarted worker stops the processes its crashed predecessor recorded
 * starting, and only those (docs/homes-build.md, P2.8, and the P2.7 to P2.9
 * review fixes).
 */

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ownProcesses, processIdentity, processRecorder, stopLeftovers } from './leftovers';

let dir: string;
let recordFile: string;
const started: number[] = [];
const workers: ChildProcess[] = [];

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-leftovers-')));
  recordFile = path.join(dir, 'worker-processes.json');
});
afterEach(() => {
  for (const w of workers.splice(0)) w.kill('SIGKILL');
  for (const pid of started.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('timed out');
}

/** A stand-in worker with one child, a stand-in harness. Resolves with both pids. */
async function workerWithChild(arg: string): Promise<{ worker: ChildProcess; child: number }> {
  const worker = spawn(process.execPath, ['-e', `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', '--', ${JSON.stringify(arg)}], { stdio: 'ignore' });
    console.log(child.pid);
    setTimeout(() => {}, 60000);
  `], { stdio: ['ignore', 'pipe', 'ignore'] });
  workers.push(worker);
  const child = await new Promise<number>((resolve) => worker.stdout!.once('data', (d: Buffer) => resolve(Number(d.toString().trim()))));
  started.push(child);
  return { worker, child };
}

/** A process no worker started, orphaned, whose command line carries `arg`. */
function unrelatedOrphan(arg: string): number {
  const pid = Number(
    execFileSync('sh', ['-c', `node -e "setTimeout(() => {}, 60000)" -- "${arg}" > /dev/null 2>&1 & echo $!`]).toString().trim(),
  );
  started.push(pid);
  return pid;
}

async function record(workerPid: number): Promise<void> {
  const own = await ownProcesses(workerPid);
  fs.writeFileSync(recordFile, JSON.stringify(own));
}

it('stops what a crashed worker recorded starting, and leaves a process that only names its files', async () => {
  const instructions = path.join(dir, 'work', 'session-instructions', 'chat-1.md');
  const { worker, child } = await workerWithChild(`--append-system-prompt-file=${instructions}`);
  const bystander = unrelatedOrphan(`--append-system-prompt-file=${instructions}`);
  await until(async () => (await ownProcesses(worker.pid!))?.children.some((c) => c.pid === child) ?? false);
  await record(worker.pid!);

  worker.kill('SIGKILL');
  await until(async () => (await processIdentity(worker.pid!)) === null);
  expect(alive(child)).toBe(true);

  expect(await stopLeftovers(recordFile, 2_000)).toEqual([child]);
  await until(() => !alive(child));
  expect(alive(bystander)).toBe(true);
}, 20_000);

it('leaves everything alone while the recorded worker is still running', async () => {
  const { worker, child } = await workerWithChild('harness');
  await until(async () => (await ownProcesses(worker.pid!))?.children.some((c) => c.pid === child) ?? false);
  await record(worker.pid!);

  expect(await stopLeftovers(recordFile, 500)).toEqual([]);
  expect(alive(child)).toBe(true);
}, 20_000);

it('never signals a recorded pid now held by a different process', async () => {
  const other = unrelatedOrphan('reused');
  await until(async () => (await processIdentity(other)) !== null);
  const now = (await processIdentity(other))!;
  // The recorded worker is gone. Its child's pid now belongs to another
  // process: a different start time, or the same start time with another
  // command line.
  fs.writeFileSync(recordFile, JSON.stringify({
    worker: { pid: 999_999, ppid: 1, started: 'Mon Jan 1 00:00:00 2001', command: 'ri worker run' },
    children: [
      { ...now, started: 'Mon Jan 1 00:00:01 2001' },
      { ...now, command: 'claude --print' },
    ],
  }));
  expect(await stopLeftovers(recordFile, 500)).toEqual([]);
  expect(alive(other)).toBe(true);
}, 20_000);

it('records this process and its children, one listing at a time', async () => {
  const { worker, child } = await workerWithChild('harness');
  await until(async () => (await ownProcesses(worker.pid!))?.children.some((c) => c.pid === child) ?? false);
  const recordOwn = processRecorder(recordFile);
  await Promise.all([recordOwn(), recordOwn()]);
  const written = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  expect(written.worker.pid).toBe(process.pid);
  expect(written.children.map((c: { pid: number }) => c.pid)).toContain(worker.pid);
  // The `ps` it ran to list them isn't one of them.
  expect(written.children.every((c: { command: string }) => !c.command.startsWith('ps '))).toBe(true);
}, 20_000);
