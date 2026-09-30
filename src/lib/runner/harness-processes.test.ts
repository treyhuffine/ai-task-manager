/**
 * One harness per chat (harness-processes.ts): the record stops what a
 * previous owner left and what this one lost track of, and only processes it
 * recorded, still the same processes, whose owner isn't another live one.
 * Real processes throughout: the stand-in harnesses and owners are node
 * sleepers, and a gone owner is one that has exited.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { processIdentity, type ProcessIdentity } from '@/lib/worker/leftovers';
import {
  _resetHarnessProcessState,
  forgetHarnessProcess,
  recordHarnessProcess,
  signalOwnHarnesses,
  stopOrphanedHarnesses,
  stopStrayHarness,
} from './harness-processes';

let dir: string;
let file: string;
const children: ChildProcess[] = [];

beforeEach(() => {
  _resetHarnessProcessState();
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-harness-processes-')));
  file = path.join(dir, 'harness-processes.json');
});
afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
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

/** A running stand-in process and its identity. */
async function sleeper(): Promise<{ child: ChildProcess; identity: ProcessIdentity }> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  children.push(child);
  for (let i = 0; i < 100; i++) {
    const identity = await processIdentity(child.pid!);
    if (identity) return { child, identity };
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('sleeper never showed up in ps');
}

/** The identity of a process that has since exited: a server that died. */
async function goneOwner(): Promise<ProcessIdentity> {
  const { child, identity } = await sleeper();
  const exited = new Promise((r) => child.once('exit', r));
  child.kill('SIGKILL');
  await exited;
  return identity;
}

async function self(): Promise<ProcessIdentity> {
  return (await processIdentity(process.pid))!;
}

function write(entries: Array<{ chatSessionId: string; owner: ProcessIdentity; process: ProcessIdentity }>): void {
  fs.writeFileSync(file, JSON.stringify({ entries }));
}

function recorded(): Array<{ chatSessionId: string; process: { pid: number } }> {
  return JSON.parse(fs.readFileSync(file, 'utf8')).entries;
}

async function exitOf(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((r) => child.once('exit', r));
}

describe('recording', () => {
  it('writes a harness down by chat, replaces its own earlier entry, and forgets only that process', async () => {
    const first = await sleeper();
    const second = await sleeper();
    await recordHarnessProcess('chat-1', first.child.pid!, file);
    expect(recorded().map((e) => [e.chatSessionId, e.process.pid])).toEqual([['chat-1', first.child.pid]]);

    // A later process for the chat (a per-turn harness) takes its place.
    await recordHarnessProcess('chat-1', second.child.pid!, file);
    expect(recorded().map((e) => e.process.pid)).toEqual([second.child.pid]);

    // A late forget for the old process leaves the new one.
    await forgetHarnessProcess('chat-1', first.child.pid!, file);
    expect(recorded().map((e) => e.process.pid)).toEqual([second.child.pid]);
    await forgetHarnessProcess('chat-1', second.child.pid!, file);
    expect(recorded()).toEqual([]);
  });

  it('keeps nothing for a process that already exited', async () => {
    const gone = await goneOwner();
    await recordHarnessProcess('chat-1', gone.pid, file);
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe('at startup', () => {
  it("stops a harness whose server is gone, and leaves a live owner's and a reused pid alone", async () => {
    const leftover = await sleeper();
    const liveOwner = await sleeper();
    const otherServers = await sleeper();
    const reused = await sleeper();
    write([
      { chatSessionId: 'orphaned', owner: await goneOwner(), process: leftover.identity },
      { chatSessionId: 'elsewhere', owner: liveOwner.identity, process: otherServers.identity },
      // The pid is running, but not as the process recorded: a reused pid.
      { chatSessionId: 'reused', owner: await goneOwner(), process: { ...reused.identity, started: 'Thu Jan  1 00:00:00 2026' } },
    ]);

    const stopped = await stopOrphanedHarnesses(file, 2_000);

    expect(stopped).toEqual([leftover.child.pid]);
    await exitOf(leftover.child);
    expect(alive(otherServers.child.pid!)).toBe(true);
    expect(alive(reused.child.pid!)).toBe(true);
    // The live owner's entry stays. The stopped one and the stale one go.
    expect(recorded().map((e) => e.chatSessionId)).toEqual(['elsewhere']);
  });

  it('has nothing to do with no record', async () => {
    expect(await stopOrphanedHarnesses(file)).toEqual([]);
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("before a chat's session starts", () => {
  it('stops a harness a previous server left for that chat, and only that chat', async () => {
    const leftover = await sleeper();
    const otherChat = await sleeper();
    const owner = await goneOwner();
    write([
      { chatSessionId: 'chat-1', owner, process: leftover.identity },
      { chatSessionId: 'chat-2', owner, process: otherChat.identity },
    ]);

    expect(await stopStrayHarness('chat-1', file, 2_000)).toEqual([leftover.child.pid]);
    await exitOf(leftover.child);
    expect(alive(otherChat.child.pid!)).toBe(true);
    expect(recorded().map((e) => e.chatSessionId)).toEqual(['chat-2']);
  });

  it('stops one of its own it lost track of', async () => {
    const lost = await sleeper();
    write([{ chatSessionId: 'chat-1', owner: await self(), process: lost.identity }]);

    expect(await stopStrayHarness('chat-1', file, 2_000)).toEqual([lost.child.pid]);
    await exitOf(lost.child);
    expect(recorded()).toEqual([]);
  });

  it("refuses to start beside a harness another live process owns, and doesn't touch it", async () => {
    const theirs = await sleeper();
    const owner = await sleeper();
    write([{ chatSessionId: 'chat-1', owner: owner.identity, process: theirs.identity }]);

    await expect(stopStrayHarness('chat-1', file, 2_000)).rejects.toMatchObject({ code: 'already_running' });
    expect(alive(theirs.child.pid!)).toBe(true);
    expect(recorded().map((e) => e.chatSessionId)).toEqual(['chat-1']);
  });

  it('SIGKILLs a harness that ignores SIGTERM', async () => {
    const stubborn = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' });
    children.push(stubborn);
    await new Promise((r) => setTimeout(r, 200));
    write([{ chatSessionId: 'chat-1', owner: await goneOwner(), process: (await processIdentity(stubborn.pid!))! }]);

    expect(await stopStrayHarness('chat-1', file, 300)).toEqual([stubborn.pid]);
    await exitOf(stubborn);
    expect(stubborn.signalCode).toBe('SIGKILL');
  });

  it('drops an entry whose process has exited, and stops nothing', async () => {
    write([{ chatSessionId: 'chat-1', owner: await goneOwner(), process: await goneOwner() }]);
    expect(await stopStrayHarness('chat-1', file)).toEqual([]);
    expect(recorded()).toEqual([]);
  });
});

describe('at exit', () => {
  it("signals this process's own harnesses, and not another owner's or a reused pid", async () => {
    const mine = await sleeper();
    const theirs = await sleeper();
    const reused = await sleeper();
    const me = await self();
    write([
      { chatSessionId: 'chat-1', owner: me, process: mine.identity },
      { chatSessionId: 'chat-2', owner: await goneOwner(), process: theirs.identity },
      { chatSessionId: 'chat-3', owner: me, process: { ...reused.identity, command: 'claude --print' } },
    ]);

    expect(signalOwnHarnesses(me, file)).toEqual([mine.child.pid]);
    await exitOf(mine.child);
    expect(mine.child.signalCode).toBe('SIGTERM');
    expect(alive(theirs.child.pid!)).toBe(true);
    expect(alive(reused.child.pid!)).toBe(true);
  });
});
