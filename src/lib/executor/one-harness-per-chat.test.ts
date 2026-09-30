/**
 * One harness per chat, end to end through the real executor with the fake
 * harness running real stand-in processes (src/lib/runner/harness-processes.ts).
 *
 * The bug: a server that died without closing its harnesses left each one
 * working on unseen, and the chat's next message started a second harness on
 * the same native session beside it. Found live with Claude: the second
 * marked the first's running tool call interrupted, the first finished it
 * anyway, and both wrote one transcript and one folder. The same happened
 * inside one server when it lost a handle whose process lived on.
 */

import fs from 'node:fs';
import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { processIdentity, type ProcessIdentity } from '@/lib/worker/leftovers';
import { spawn } from 'node:child_process';

let home: TestHome | null = null;
let fake: FakeHarness | null = null;
const extra: ChildProcess[] = [];

afterEach(async () => {
  const { _resetExecutorState } = await import('./adapter');
  const { _resetHarnessProcessState } = await import('@/lib/runner/harness-processes');
  _resetExecutorState();
  _resetHarnessProcessState();
  for (const child of extra.splice(0)) child.kill('SIGKILL');
  fake?.restore();
  fake = null;
  await home?.cleanup();
  home = null;
});

async function chat() {
  home = await createTestHome({ prefix: 'ri-one-harness-' });
  fake = installFakeHarness('claude');
  fake.withProcess = true;
  const q = await import('@/lib/db/queries');
  return q.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active', permissionMode: 'auto_all' });
}

const alive = (proc: ChildProcess) => proc.exitCode === null && proc.signalCode === null;

async function exitOf(proc: ChildProcess): Promise<void> {
  if (!alive(proc)) return;
  await new Promise((r) => proc.once('exit', r));
}

async function record(): Promise<Array<{ chatSessionId: string; owner: ProcessIdentity; process: ProcessIdentity }>> {
  const { harnessProcessRecordPath } = await import('@/lib/runner/harness-processes');
  const file = harnessProcessRecordPath();
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).entries : [];
}

async function rewriteOwner(owner: ProcessIdentity): Promise<void> {
  const { harnessProcessRecordPath } = await import('@/lib/runner/harness-processes');
  const entries = (await record()).map((e) => ({ ...e, owner }));
  fs.writeFileSync(harnessProcessRecordPath(), JSON.stringify({ entries }));
}

/** A server that has died: the identity of a process that has exited. */
async function deadServer(): Promise<ProcessIdentity> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  let identity: ProcessIdentity | null = null;
  while (!identity) identity = await processIdentity(child.pid!);
  child.kill('SIGKILL');
  await exitOf(child);
  return identity;
}

describe('one harness per chat', () => {
  it('records the harness when its session starts, before the first message reaches it', async () => {
    const session = await chat();
    const { dispatch } = await import('./adapter');
    await dispatch(session.id, 'first');
    const harness = fake!.latest().proc!;
    expect(await record()).toMatchObject([{ chatSessionId: session.id, process: { pid: harness.pid } }]);
  });

  it('after a restart, stops the harness the previous server left before the next message starts one', async () => {
    const session = await chat();
    const { dispatch, _resetExecutorState } = await import('./adapter');
    await dispatch(session.id, 'first');
    const leftover = fake!.latest().proc!;

    // The server dies without closing it: its state is gone, its harness isn't.
    _resetExecutorState();
    await rewriteOwner(await deadServer());
    expect(alive(leftover)).toBe(true);

    let leftoverRunningDuringNewTurn: boolean | null = null;
    fake!.onTurn(async (turn) => {
      leftoverRunningDuringNewTurn = alive(leftover);
      await turn.say('ok');
    });
    await dispatch(session.id, 'second');

    expect(fake!.sessions).toHaveLength(2);
    await exitOf(leftover);
    expect(leftoverRunningDuringNewTurn).toBe(false);
    const successor = fake!.latest().proc!;
    expect(alive(successor)).toBe(true);
    expect((await record()).map((e) => e.process.pid)).toEqual([successor.pid]);
  });

  it('startup stops every harness a previous server left, for chats nobody writes to again', async () => {
    const session = await chat();
    const { dispatch, _resetExecutorState } = await import('./adapter');
    await dispatch(session.id, 'first');
    const leftover = fake!.latest().proc!;
    _resetExecutorState();
    await rewriteOwner(await deadServer());

    const { stopOrphanedHarnesses } = await import('@/lib/runner/harness-processes');
    expect(await stopOrphanedHarnesses()).toEqual([leftover.pid]);
    await exitOf(leftover);
    expect(await record()).toEqual([]);
  });

  it('stops a harness whose handle this server dropped while its process lived on', async () => {
    const session = await chat();
    const { dispatch, invalidateHarnessSession } = await import('./adapter');
    await dispatch(session.id, 'first');
    const lost = fake!.latest().proc!;

    // The health check judged the handle dead and dropped it, wrongly.
    invalidateHarnessSession(session.id);
    await dispatch(session.id, 'second');

    await exitOf(lost);
    expect(fake!.sessions).toHaveLength(2);
    expect(alive(fake!.latest().proc!)).toBe(true);
  });

  it("won't start beside a harness another running Ri process owns", async () => {
    const session = await chat();
    const { dispatch, _resetExecutorState } = await import('./adapter');
    await dispatch(session.id, 'first');
    const theirs = fake!.latest().proc!;
    _resetExecutorState();
    const otherServer = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    extra.push(otherServer);
    let identity: ProcessIdentity | null = null;
    while (!identity) identity = await processIdentity(otherServer.pid!);
    await rewriteOwner(identity);

    await dispatch(session.id, 'second').catch(() => {});

    expect(fake!.sessions).toHaveLength(1);
    expect(alive(theirs)).toBe(true);
  });

  it('forgets a harness its session closed cleanly', async () => {
    const session = await chat();
    const { dispatch } = await import('./adapter');
    const { close } = await import('@/lib/runner/local-runner');
    await dispatch(session.id, 'first');
    const harness = fake!.latest().proc!;

    expect((await close(session.id)).closed).toBe(true);
    await exitOf(harness);
    await new Promise((r) => setTimeout(r, 50));
    expect(await record()).toEqual([]);
  });
});
