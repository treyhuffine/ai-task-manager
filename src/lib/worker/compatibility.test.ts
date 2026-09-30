import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CURRENT_COMPATIBILITY } from '@/lib/releases/compatibility';
import { WorkerProtocolError, WorkerStoppedError, workerFetch, type WorkerTarget } from './client';
import { runWorker, type WorkerStatus } from './run';
import { CommandJournal } from './command-journal';
import { EventJournal } from './event-journal';
import { clearMaintenance, writeMaintenance } from '@/lib/service/maintenance';
const cleanup = vi.hoisted(() => ({ terminals: vi.fn(async () => {}), leftovers: vi.fn(async () => []), close: vi.fn(async () => []), identity: vi.fn(async (pid: number) => ({ pid, started: 'fixture', command: 'fixture-worker' })) }));
vi.mock('./leftovers', () => ({ processRecorder: () => async () => {}, stopLeftovers: cleanup.leftovers, processIdentity: cleanup.identity }));
vi.mock('./terminals', () => ({ WorkerTerminals: class { closeAll = cleanup.terminals; releaseExecution = async () => 0; } }));
vi.mock('@/lib/runner/local-runner', () => ({ closeAllSessions: cleanup.close, close: vi.fn(), producingRun: () => null }));
const target: WorkerTarget = { homeId: 'home', homeUrl: 'http://127.0.0.1:9', homeName: 'Mini', deviceName: 'MacBook', workerKey: 'test' };
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-worker-compat-')); vi.stubEnv('RI_WORK_DIR', root); vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
it('treats incompatible versions as retryable, but revoked enrollment still stops', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ update: 'home', message: 'Update Ri on Mini.' }, { status: 426 })));
  await expect(workerFetch(target, '/api/workers/me')).rejects.toBeInstanceOf(WorkerProtocolError);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })));
  await expect(workerFetch(target, '/api/workers/me')).rejects.toBeInstanceOf(WorkerStoppedError);
});
it('keeps ownership, pending journals and live work through mismatch until compatible reconnect', async () => {
  const events = new EventJournal('home');
  events.append({ kind: 'signal', eventId: 'e', chatSessionId: 'chat', generation: null, occurredAt: new Date().toISOString(), signal: { type: 'running', running: false } } as never);
  const commands = new CommandJournal('home');
  const abort = new AbortController();
  let mismatch = true;
  const statuses: WorkerStatus[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (mismatch) return Response.json({ update: 'home', message: 'Update Ri on Mini.' }, { status: 426 });
    if (url.includes('/heartbeat')) return Response.json({ ok: true, release: [] });
    if (url.includes('/events')) return Response.json({ acked: 1 });
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`event: hello\ndata: ${JSON.stringify({ type: 'hello', homeId: 'home', deviceId: 'laptop', protocol: 4, ackedEventSeq: 0, peer: { release: { version: '8.0.0', build: 'build8', source: 'source' }, compatibility: CURRENT_COMPATIBILITY } })}\n\n`)); controller.close(); } }));
  }));
  const worker = runWorker({ target, version: 'test', signal: abort.signal, describe: async () => [], journals: { commands, events }, backoffMinMs: 1, backoffMaxMs: 2,
    onStatus(status) {
      statuses.push(status);
      if (status.state === 'update-required') {
        expect(events.pending()).toHaveLength(1);
        expect(cleanup.close).not.toHaveBeenCalled();
        expect(cleanup.terminals).not.toHaveBeenCalled();
        mismatch = false;
      }
      if (status.state === 'connected') abort.abort();
    } });
  expect(await worker).toEqual({ reason: 'stopped' });
  expect(statuses.some(s => s.state === 'update-required')).toBe(true);
  expect(statuses.some(s => s.state === 'connected')).toBe(true);
  expect(cleanup.leftovers).toHaveBeenCalledTimes(1); // No restart/recovery of live harnesses on mismatch.
  await vi.waitFor(() => expect(events.pending()).toHaveLength(0));
});
it('never accepts a command before authenticated hello', async () => {
  const abort = new AbortController();
  const commands = new CommandJournal('home');
  const handler = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(`event: command\ndata: ${JSON.stringify({ type: 'command', command: { id: 'bad', seq: 1, kind: 'send' } })}\n\n`)));
  await runWorker({ target, version: 'test', signal: abort.signal, describe: async () => [], journals: { commands, events: new EventJournal('home') }, handlers: { send: { run: handler, recover: handler } },
    onStatus: status => { if (status.state === 'disconnected') abort.abort(); } });
  expect(commands.cursor()).toBe(0);
  expect(handler).not.toHaveBeenCalled();
});
it('runs teardown under the ownership lock even when startup fails', async () => {
  const finish = vi.fn(async () => {});
  await expect(runWorker({ target, version: 'test', onJournals: () => { throw new Error('startup failed'); }, beforeUnlock: finish })).rejects.toThrow('startup failed');
  expect(finish).toHaveBeenCalledWith(undefined);
});

it('pauses admission without advancing receipts and resumes the queued command once', async () => {
  const abort = new AbortController();
  const commands = new CommandJournal('home');
  let paused = false;
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  const command = { id: 'once', seq: 1, kind: 'send', target: { executionId: null, chatSessionId: 'chat', generation: null }, payload: {}, actor: {}, issuedAt: new Date().toISOString() };
  const frame = (type: string, value: object) => new TextEncoder().encode(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
  const handler = vi.fn(async () => { abort.abort(); return { state: 'delivered' as const }; });
  let connections = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (url.includes('/heartbeat')) return Response.json({ ok: true, release: [] });
    if (url.includes('/ack')) return Response.json({ ok: true });
    connections++;
    return new Response(new ReadableStream({ start(controller) {
      stream = controller;
      init.signal?.addEventListener('abort', () => { try { controller.close(); } catch {} }, { once: true });
      controller.enqueue(frame('hello', { homeId: 'home', deviceId: 'laptop', protocol: 4, ackedEventSeq: 0 }));
      if (connections > 1) controller.enqueue(frame('command', { command }));
    } }));
  }));
  let deferred: ReturnType<typeof setTimeout> | undefined;
  const worker = runWorker({ target, version: 'test', signal: abort.signal, describe: async () => [], paused: () => paused,
    journals: { commands, events: new EventJournal('home') }, handlers: { send: { run: handler, recover: handler } }, backoffMinMs: 1, backoffMaxMs: 2,
    onStatus: status => {
      if (status.state === 'connected' && connections === 1) {
        paused = true;
        stream!.enqueue(frame('command', { command }));
        deferred = setTimeout(() => { expect(commands.cursor()).toBe(0); expect(handler).not.toHaveBeenCalled(); paused = false; }, 20);
      }
    } });
  await worker;
  clearTimeout(deferred);
  expect(handler).toHaveBeenCalledTimes(1);
  expect(commands.cursor()).toBe(1);
});


it('blocks new workers during maintenance before journals or ownership are opened', async () => {
  const opened = vi.fn();
  writeMaintenance({ phase: 'draining', token: 'update-test', startedAt: new Date().toISOString() });
  try {
    await expect(runWorker({ target, version: 'test', onJournals: opened })).rejects.toThrow('preparing an update');
    expect(opened).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(root, 'worker.lock'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'commands'))).toBe(false);
  } finally { clearMaintenance(); }
});

it('rechecks admission after taking ownership when an update starts during lock acquisition', async () => {
  const opened = vi.fn();
  cleanup.identity.mockImplementationOnce(async pid => {
    writeMaintenance({ phase: 'draining', token: 'racing-update', startedAt: new Date().toISOString() });
    return { pid, started: 'fixture', command: 'fixture-worker' };
  });
  try {
    await expect(runWorker({ target, version: 'test', onJournals: opened })).rejects.toThrow('preparing an update');
    expect(opened).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(root, 'worker.lock'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'commands'))).toBe(false);
  } finally { clearMaintenance(); }
});
