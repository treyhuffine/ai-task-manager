import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkerCommand } from '@/lib/workers/protocol';
import { CommandJournal } from './command-journal';
import { CommandProcessor, type CommandKindHandler } from './commands';

vi.mock('./client', async importOriginal => ({
  ...await importOriginal<typeof import('./client')>(),
  workerFetch: vi.fn(async () => new Response('{}')),
}));

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-command-barrier-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function command(seq: number, kind: WorkerCommand['kind'], chatSessionId = 'chat'): WorkerCommand {
  return { id: `cmd-${seq}`, seq, kind, payload: {}, target: { executionId: 'exec', chatSessionId, generation: 1 },
    actor: { source: 'human' }, issuedAt: new Date().toISOString() };
}

const target = { homeUrl: 'http://home', homeId: 'home', homeName: 'Home', deviceName: 'Laptop', workerKey: 'test' };

it('keeps controls behind an unstarted chat while allowing the waiting chat to finish', async () => {
  const journal = new CommandJournal('home', path.join(dir, 'commands.jsonl'));
  const setup = deferred();
  const turn = deferred();
  const waiting = deferred();
  const log: string[] = [];
  const send: CommandKindHandler = {
    async run(c, ctx) {
      if (c.seq === 1) {
        await setup.promise;
        waiting.resolve();
        await ctx.waitForTurnEnd!(() => turn.promise);
      }
      log.push(c.id);
      return { state: 'delivered' };
    },
    recover: (c, _stage, ctx) => send.run(c, ctx),
  };
  const answer: CommandKindHandler = {
    async run(c) { log.push(c.id); if (c.target.chatSessionId === 'chat') turn.resolve(); return { state: 'delivered' }; },
    recover: (c, _stage, ctx) => answer.run(c, ctx),
  };
  const processor = new CommandProcessor({ journal, target, handlers: { send, answer_pending_input: answer } });
  processor.receive(command(1, 'send'));
  processor.receive(command(2, 'send'));
  processor.receive(command(3, 'answer_pending_input', 'other-chat'));
  processor.receive(command(4, 'answer_pending_input'));
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(log).toEqual([]);
  setup.resolve();
  await waiting.promise;
  await processor.idle();
  expect(log).toEqual(['cmd-4', 'cmd-1', 'cmd-2', 'cmd-3']);
});

it('services an already-running sibling chat while its follow-up remains behind another chat\'s recycle', async () => {
  const journal = new CommandJournal('home', path.join(dir, 'commands.jsonl'));
  const turn = deferred();
  const waiting = deferred();
  const answered = deferred();
  const log: string[] = [];
  let siblingRunning = false;
  const send: CommandKindHandler = {
    async run(c) { siblingRunning = true; log.push(c.id); return { state: 'delivered' }; },
    recover: (c, _stage, ctx) => send.run(c, ctx),
  };
  const recycle: CommandKindHandler = {
    async run(c, ctx) { waiting.resolve(); await ctx.waitForTurnEnd!(() => turn.promise); log.push(c.id); return { state: 'delivered' }; },
    recover: (c, _stage, ctx) => recycle.run(c, ctx),
  };
  const answer: CommandKindHandler = {
    canPassIdleWait: c => siblingRunning && c.target.chatSessionId === 'sibling',
    async run(c) { log.push(c.id); answered.resolve(); return { state: 'delivered' }; },
    recover: (c, _stage, ctx) => answer.run(c, ctx),
  };
  const processor = new CommandProcessor({ journal, target, handlers: { send, recycle, answer_pending_input: answer } });
  processor.receive(command(1, 'send', 'sibling'));
  processor.receive(command(2, 'recycle'));
  processor.receive(command(3, 'send', 'sibling'));
  processor.receive(command(4, 'answer_pending_input', 'sibling'));
  await waiting.promise;
  await answered.promise;
  expect(log).toEqual(['cmd-1', 'cmd-4']);
  turn.resolve();
  await processor.idle();
  expect(log).toEqual(['cmd-1', 'cmd-4', 'cmd-2', 'cmd-3']);
});

it.each([false, true])('an explicit close cancels an unsent active wait and earlier queued sends, including during recovery=%s', async recovery => {
  const journal = new CommandJournal('home', path.join(dir, 'commands.jsonl'));
  const turn = deferred();
  const closing = deferred();
  const teardown = deferred();
  const delivered: number[] = [];
  const send: CommandKindHandler = {
    async run(c, ctx) {
      if (c.seq === 1) await ctx.waitForTurnEnd!(() => turn.promise);
      delivered.push(c.seq);
      return { state: 'delivered' };
    },
    recover: (c, _stage, ctx) => send.run(c, ctx),
  };
  const stop: CommandKindHandler = {
    async run() { closing.resolve(); turn.resolve(); await teardown.promise; return { state: 'delivered' }; },
    recover: (c, _stage, ctx) => stop.run(c, ctx),
  };
  const processor = new CommandProcessor({ journal, target, handlers: { send, stop } });
  const commands = [command(1, 'send'), command(2, 'send'), command(3, 'stop'), command(4, 'send')];
  let recovered: Promise<void> | undefined;
  if (recovery) {
    for (const c of commands) journal.received(c);
    recovered = processor.recoverAll();
  } else {
    for (const c of commands) processor.receive(c);
  }
  await closing.promise;
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(delivered).toEqual([]);
  teardown.resolve();
  await recovered;
  await processor.idle();
  expect(delivered).toEqual([4]);
  expect(journal.get('cmd-1')?.ack).toMatchObject({ state: 'failed', error: expect.stringContaining('closed before') });
  expect(journal.get('cmd-2')?.ack?.state).toBe('failed');
  expect(journal.get('cmd-3')?.ack?.state).toBe('delivered');
  expect(journal.get('cmd-4')?.ack?.state).toBe('delivered');
});

it('leaves unsent work recoverable when worker shutdown makes a waiting session idle', async () => {
  const journal = new CommandJournal('home', path.join(dir, 'commands.jsonl'));
  const turn = deferred();
  const waiting = deferred();
  const delivered: number[] = [];
  const send: CommandKindHandler = {
    async run(c, ctx) {
      waiting.resolve();
      await ctx.waitForTurnEnd!(() => turn.promise);
      delivered.push(c.seq);
      return { state: 'delivered' };
    },
    recover: (c, _stage, ctx) => send.run(c, ctx),
  };
  const processor = new CommandProcessor({ journal, target, handlers: { send } });
  processor.receive(command(1, 'send'));
  processor.receive(command(2, 'send'));
  await waiting.promise;
  processor.stop();
  turn.resolve();
  await processor.idle();
  expect(delivered).toEqual([]);
  expect(journal.get('cmd-1')?.stage).toBe('received');
  expect(journal.get('cmd-2')?.stage).toBe('received');
  const resumed: CommandKindHandler = {
    async run(c) { delivered.push(c.seq); return { state: 'delivered' }; },
    recover: (c, _stage, ctx) => resumed.run(c, ctx),
  };
  const successor = new CommandProcessor({ journal: new CommandJournal('home', path.join(dir, 'commands.jsonl')), target, handlers: { send: resumed } });
  await successor.recoverAll();
  expect(delivered).toEqual([1, 2]);
});
