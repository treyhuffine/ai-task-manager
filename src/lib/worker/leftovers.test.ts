/**
 * A restarted worker stops the harness processes its crashed predecessor
 * left running, and only those (docs/homes-build.md, P2.8).
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { findLeftovers, stopLeftoverHarnesses } from './leftovers';

let dir: string;
const started: number[] = [];

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-leftovers-')));
});
afterEach(() => {
  for (const pid of started.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

/** An orphaned process whose command line carries `arg`, as a crashed worker's harness would be. */
function orphanWith(arg: string): number {
  const pid = Number(
    execFileSync('sh', ['-c', `node -e "setTimeout(() => {}, 60000)" -- "${arg}" > /dev/null 2>&1 & echo $!`]).toString().trim(),
  );
  started.push(pid);
  return pid;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out');
}

it("stops an orphan that names this worker's instructions folder, and leaves others alone", async () => {
  const marker = path.join(dir, 'work', 'session-instructions') + path.sep;
  const ours = orphanWith(`--append-system-prompt-file=${marker}chat-1.md`);
  const theirs = orphanWith(`--append-system-prompt-file=${path.join(dir, 'other-work', 'session-instructions', 'chat-2.md')}`);
  await until(async () => (await findLeftovers(marker)).includes(ours));

  expect(await stopLeftoverHarnesses(marker, 2_000)).toEqual([ours]);
  await until(() => !alive(ours));
  expect(alive(theirs)).toBe(true);
}, 20_000);
