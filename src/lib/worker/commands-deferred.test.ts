import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CommandJournal } from './command-journal';
import { CommandProcessor, WorkerCommandDeferredError, type CommandKindHandler } from './commands';
import type { WorkerCommand } from '@/lib/workers/protocol';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-deferred-command-'));
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true })));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fs.rmSync(root, { recursive: true, force: true });
});
const target = { homeId: 'fixture-home', homeUrl: 'http://localhost', homeName: 'Home', deviceName: 'Laptop', workerKey: 'fixture' };
function command(id: string, seq = 1, kind: WorkerCommand['kind'] = 'send'): WorkerCommand {
  return { id, seq, kind, target: { executionId: 'work', chatSessionId: 'chat', generation: 1 }, actor: { source: 'system' }, issuedAt: new Date().toISOString(), payload: {} };
}

it('keeps held sends out of the control queue and respects update pause before retrying', async () => {
  const journal = new CommandJournal(target.homeId, path.join(root, 'commands.jsonl'));
  let held = true, paused = false;
  const effects: string[] = [];
  const run: CommandKindHandler['run'] = async (input, context) => {
    if (input.kind === 'send' && held) throw new WorkerCommandDeferredError('Held');
    context.markStarted();
    effects.push(input.id);
    return { state: 'delivered' };
  };
  const handler = { run, recover: (input: WorkerCommand, _stage: 'received'|'started', context: Parameters<typeof run>[1]) => run(input, context) };
  const processor = new CommandProcessor({ journal, target, paused: () => paused, handlers: { send: handler, interrupt: handler } });
  processor.receive(command('held'));
  await processor.idle();
  processor.receive(command('stop', 2, 'interrupt'));
  await processor.idle();
  expect(effects).toEqual(['stop']);
  expect(journal.get('held')?.stage).toBe('received');
  held = false;
  paused = true;
  await vi.advanceTimersByTimeAsync(1000);
  expect(effects).toEqual(['stop']);
  paused = false;
  await vi.advanceTimersByTimeAsync(2000);
  expect(effects).toEqual(['stop', 'held']);
  processor.stop();
});

it('leaves deferred work for recovery instead of starting it after the worker exits', async () => {
  const journal = new CommandJournal(target.homeId, path.join(root, 'commands.jsonl'));
  const effects: string[] = [];
  const held: CommandKindHandler = { run: async () => { throw new WorkerCommandDeferredError('Held'); }, recover: async () => { throw new WorkerCommandDeferredError('Held'); } };
  const processor = new CommandProcessor({ journal, target, handlers: { send: held } });
  processor.receive(command('saved'));
  await processor.idle();
  processor.stop();
  await vi.advanceTimersByTimeAsync(5000);
  expect(journal.get('saved')?.stage).toBe('received');
  const run: CommandKindHandler['run'] = async (input, context) => { context.markStarted(); effects.push(input.id); return { state: 'delivered' }; };
  const successor = new CommandProcessor({ journal, target, handlers: { send: { run, recover: (input, _stage, context) => run(input, context) } } });
  await successor.recoverAll();
  successor.receive(command('saved'));
  await successor.idle();
  expect(effects).toEqual(['saved']);
  expect(journal.get('saved')?.stage).toBe('confirmed');
  successor.stop();
});

it.each(['stop','quiesce'] as const)('retires a deferred input when %s closes its chat instead of reviving it on retry',async kind=>{
  const journal=new CommandJournal(target.homeId,path.join(root,'commands.jsonl'));
  const effects:string[]=[];
  const send:CommandKindHandler={run:async()=>{throw new WorkerCommandDeferredError('Held');},recover:async()=>{throw new WorkerCommandDeferredError('Held');}};
  const close:CommandKindHandler={run:async(input,context)=>{context.markStarted();effects.push(input.id);return{state:'delivered'};},recover:async()=>({state:'delivered'})};
  const processor=new CommandProcessor({journal,target,handlers:{send,[kind]:close}});
  processor.receive(command('pending'));
  await processor.idle();
  processor.receive({...command('close',2,kind),payload:kind==='quiesce'?{chatSessionIds:['chat']}: {}});
  await processor.idle();
  await vi.advanceTimersByTimeAsync(5000);
  expect(effects).toEqual(['close']);
  expect(journal.get('pending')).toMatchObject({stage:'confirmed',ack:{state:'failed',error:'The chat was closed before this message could be sent.'}});
  processor.stop();
});
