/**
 * Enrollment and the worker connection (docs/homes-build.md, P2.2), end to
 * end over real HTTP: a test home behind its real proxy and routes, and the
 * real worker loop talking to it with fetch and an event stream.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkerHarnessReport } from '@/db/types';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { startHomeServer, type HomeServer } from '@/test/fixtures/home-server';
import type { WorkerTarget } from '@/lib/worker/client';
import type { WorkerExit, WorkerStatus } from '@/lib/worker/run';

let home: TestHome;
let server: HomeServer;
let homeId: string;
let laptopKey: string;
let laptopComputerId: string;
let browserKey: string;
const running: AbortController[] = [];

const FAKE_HARNESSES: WorkerHarnessReport[] = [
  { harness: 'claude', binary: { status: 'supported', version: '9.9.9' }, capabilities: { sessions: { supported: true } } },
];
const describeFake = async () => FAKE_HARNESSES;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-workers-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  homeId = identity.ensureHomeIdentity().home.id;
  const q = await import('@/lib/db/queries');
  const laptop = q.createApiKey({ name: 'MacBook CLI', deviceType: 'computer' });
  laptopKey = laptop.token.plaintext;
  laptopComputerId = q.registerComputerForApiKey({ apiKeyId: laptop.key.id, name: 'MacBook', platform: 'darwin' }).computer.id;
  browserKey = q.createApiKey({ name: 'MacBook browser', deviceType: 'computer' }).token.plaintext;
  server = await startHomeServer();
});

afterEach(async () => {
  for (const c of running.splice(0)) c.abort();
  const { _resetWorkerHub } = await import('@/lib/workers/hub');
  _resetWorkerHub();
  await server.close();
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  await home.cleanup();
});

async function call(path: string, init: { method?: string; bearer?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${server.url}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(init.bearer ? { authorization: `Bearer ${init.bearer}` } : {}),
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

async function enroll(opts: { code?: string; protocol?: number } = {}) {
  const code = opts.code ?? ((await call('/api/workers/grants', { bearer: laptopKey, body: {} })).json!.code as string);
  return call('/api/workers/enroll', {
    body: { code, name: 'mac', platform: 'darwin', hostname: 'Mac.lan', protocol: opts.protocol ?? 1, version: 'test' },
  });
}

async function enrolledTarget(): Promise<WorkerTarget & { workerKeyId: string }> {
  const res = await enroll();
  expect(res.status).toBe(201);
  const q = await import('@/lib/db/queries');
  const { hashToken } = await import('@/lib/auth/tokens');
  const workerKey = res.json!.workerKey as string;
  return {
    homeUrl: server.url,
    homeId,
    homeName: 'My Ri',
    computerName: 'MacBook',
    workerKey,
    workerKeyId: q.findApiKeyByHash(hashToken(workerKey))!.id,
  };
}

function start(target: WorkerTarget, statuses: WorkerStatus[] = [], extra: { staleAfterMs?: number } = {}): Promise<WorkerExit> {
  const controller = new AbortController();
  running.push(controller);
  return import('@/lib/worker/run').then(({ runWorker }) =>
    runWorker({
      target,
      version: 'test',
      signal: controller.signal,
      describe: describeFake,
      onStatus: (s) => statuses.push(s),
      backoffMinMs: 20,
      backoffMaxMs: 50,
      ...extra,
    }),
  );
}

async function until(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

describe('enrolling', () => {
  it('makes a connected computer a worker with a new key of its own', async () => {
    const target = await enrolledTarget();
    const q = await import('@/lib/db/queries');
    const { hashToken } = await import('@/lib/auth/tokens');
    expect(q.isWorkerApiKey(target.workerKeyId)).toBe(true);
    // The key it asked with is untouched: still a viewing key.
    expect(q.isWorkerApiKey(q.findApiKeyByHash(hashToken(laptopKey))!.id)).toBe(false);
    expect(q.getWorkerEnrollment(target.workerKeyId)?.computer.id).toBe(laptopComputerId);

    const { sendHeartbeat } = await import('@/lib/worker/run');
    await sendHeartbeat(target, 'test', 'awake', describeFake);
    expect(q.getComputer(laptopComputerId)).toMatchObject({
      workerProtocol: 1,
      workerVersion: 'test',
      reportedState: 'awake',
      harnesses: FAKE_HARNESSES,
    });
  });

  it('takes a code once, and not after it expires', async () => {
    const code = (await call('/api/workers/grants', { bearer: laptopKey, body: {} })).json!.code as string;
    expect((await enroll({ code })).status).toBe(201);
    expect(await enroll({ code })).toMatchObject({ status: 410, json: { error: 'used' } });

    const expiring = (await call('/api/workers/grants', { bearer: laptopKey, body: {} })).json!.code as string;
    const { getDb } = await import('@/lib/db');
    const { computerGrants } = await import('@/lib/db/schema');
    getDb().update(computerGrants).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).run();
    expect(await enroll({ code: expiring })).toMatchObject({ status: 410, json: { error: 'expired' } });
    expect(await enroll({ code: 'rg_made_up' })).toMatchObject({ status: 400, json: { error: 'invalid' } });
  });

  it("refuses to enroll the home's own computer", async () => {
    const identity = await import('@/lib/home/identity');
    const host = identity.ensureHomeIdentity().computer.id;
    const res = await call('/api/workers/grants', { bearer: laptopKey, body: { computerId: host } });
    expect(res).toMatchObject({ status: 400, json: { error: 'not_allowed' } });
  });

  it('refuses a worker on another protocol, saying what to do', async () => {
    expect((await enroll({ protocol: 99 })).status).toBe(426);
    const target = await enrolledTarget();
    const res = await call('/api/workers/me/heartbeat', {
      bearer: target.workerKey,
      headers: { 'x-ri-worker-protocol': '99' },
      body: { protocol: 99, version: 'x', harnesses: [], state: 'awake' },
    });
    expect(res.status).toBe(426);
    expect(res.json!.message).toMatch(/Update Ri on MacBook/);
  });

  it('keeps one worker per computer: enrolling again retires the earlier key', async () => {
    const first = await enrolledTarget();
    await enrolledTarget();
    const { sendHeartbeat } = await import('@/lib/worker/run');
    await expect(sendHeartbeat(first, 'test', 'awake', describeFake)).rejects.toMatchObject({ reason: 'revoked' });
  });
});

describe('the boundary between viewing and worker keys', () => {
  it('lets a worker key reach only the worker routes', async () => {
    const target = await enrolledTarget();
    expect(await call('/api/computers', { bearer: target.workerKey })).toMatchObject({ status: 403, json: { error: 'worker_key' } });
    expect(await call('/api/devices/associate', { bearer: target.workerKey, body: { code: 'x' } })).toMatchObject({ status: 403 });
  });

  it("doesn't let a viewing key pose as a worker, even with forged headers", async () => {
    await enrolledTarget();
    const res = await call('/api/workers/me/heartbeat', {
      bearer: laptopKey,
      headers: { 'x-ri-api-key-scope': 'worker', 'x-ri-worker-computer-id': laptopComputerId, 'x-ri-worker-protocol': '1' },
      body: { protocol: 1, version: 'x', harnesses: [], state: 'awake' },
    });
    expect(res).toMatchObject({ status: 403, json: { error: 'not_a_worker' } });
  });
});

describe('the connection', () => {
  it('connects, reports, and answers a request from the home', async () => {
    const target = await enrolledTarget();
    const statuses: WorkerStatus[] = [];
    void start(target, statuses);
    // The home registers the stream before the worker reads its hello, so
    // wait on the worker's side.
    await until(() => statuses.some((s) => s.state === 'connected'), 'the worker to connect');
    const { isComputerConnected } = await import('@/lib/workers/hub');
    expect(isComputerConnected(laptopComputerId)).toBe(true);

    const fresh = await call(`/api/computers/${laptopComputerId}/harnesses?fresh=1`, { bearer: laptopKey });
    expect(fresh).toMatchObject({ status: 200, json: { source: 'worker', harnesses: FAKE_HARNESSES } });

    // The first heartbeat goes out as the stream opens, without waiting on it.
    const q = await import('@/lib/db/queries');
    await until(() => q.getComputer(laptopComputerId)?.workerProtocol === 1, 'the first heartbeat');
    const list = await call('/api/computers', { bearer: laptopKey });
    const laptop = (list.json as unknown as Array<{ id: string; worker: unknown }>).find((c) => c.id === laptopComputerId);
    expect(laptop?.worker).toMatchObject({ enrolled: true, connected: true, protocol: 1, reportedState: 'awake' });
  });

  it("answers a request it doesn't know as unsupported", async () => {
    const target = await enrolledTarget();
    void start(target);
    const hub = await import('@/lib/workers/hub');
    await until(() => hub.isComputerConnected(laptopComputerId), 'the worker to connect');
    await expect(hub.requestWorker(laptopComputerId, 'no_such_request' as never)).rejects.toMatchObject({ unsupported: true });
  });

  it('only lets the computer that was asked answer', async () => {
    const target = await enrolledTarget();
    const hub = await import('@/lib/workers/hub');
    // Another worker, for another computer, answering this one's request.
    const q = await import('@/lib/db/queries');
    const other = q.createApiKey({ name: 'Other CLI', deviceType: 'computer' });
    q.registerComputerForApiKey({ apiKeyId: other.key.id, name: 'Other', platform: 'darwin' });
    const otherCode = (await call('/api/workers/grants', { bearer: other.token.plaintext, body: {} })).json!.code as string;
    const otherKey = (await enroll({ code: otherCode })).json!.workerKey as string;

    const sent: { id: string }[] = [];
    const unregister = hub.registerConnection({
      id: 'test',
      computerId: laptopComputerId,
      openedAt: Date.now(),
      send: (e) => {
        if (e.type === 'request') sent.push({ id: e.id });
      },
      close: () => {},
    });
    const pending = hub.requestWorker(laptopComputerId, 'describe_harnesses', null, 2_000);
    const wrong = await call(`/api/workers/me/requests/${sent[0]!.id}/result`, {
      bearer: otherKey,
      headers: { 'x-ri-worker-protocol': '1' },
      body: { ok: true, value: 'not yours' },
    });
    expect(wrong.status).toBe(410);
    const right = await call(`/api/workers/me/requests/${sent[0]!.id}/result`, {
      bearer: target.workerKey,
      headers: { 'x-ri-worker-protocol': '1' },
      body: { ok: true, value: 'yours' },
    });
    expect(right.status).toBe(200);
    await expect(pending).resolves.toBe('yours');
    unregister();
  });

  it('reconnects after the connection drops', async () => {
    const target = await enrolledTarget();
    const statuses: WorkerStatus[] = [];
    void start(target, statuses);
    const hub = await import('@/lib/workers/hub');
    await until(() => hub.isComputerConnected(laptopComputerId), 'the worker to connect');
    hub._dropWorkerStreams(laptopComputerId);
    await until(() => statuses.filter((s) => s.state === 'connected').length === 2, 'the worker to reconnect');
    expect(statuses.some((s) => s.state === 'disconnected')).toBe(true);
  });

  it('treats a stream gone quiet as dropped', async () => {
    const target = await enrolledTarget();
    const statuses: WorkerStatus[] = [];
    // The home pings every 15 seconds; with a 100 ms limit the stream reads as stale.
    void start(target, statuses, { staleAfterMs: 100 });
    await until(() => statuses.filter((s) => s.state === 'connected').length >= 2, 'a stale stream to be replaced');
  });

  it('stops, and says why, when its key is revoked', async () => {
    const target = await enrolledTarget();
    const exit = start(target);
    const hub = await import('@/lib/workers/hub');
    await until(() => hub.isComputerConnected(laptopComputerId), 'the worker to connect');
    expect((await call(`/api/devices/${target.workerKeyId}`, { method: 'DELETE', bearer: laptopKey })).status).toBe(204);
    await expect(exit).resolves.toMatchObject({ reason: 'revoked' });
    expect(hub.isComputerConnected(laptopComputerId)).toBe(false);
  });

  it('stops when the address answers for a different home', async () => {
    const target = await enrolledTarget();
    await expect(start({ ...target, homeId: 'another-home' })).resolves.toMatchObject({ reason: 'wrong_home' });
  });

  it('turns itself off from its own computer', async () => {
    const target = await enrolledTarget();
    const res = await call('/api/workers/me', { method: 'DELETE', bearer: target.workerKey, headers: { 'x-ri-worker-protocol': '1' } });
    expect(res.status).toBe(204);
    const { sendHeartbeat } = await import('@/lib/worker/run');
    await expect(sendHeartbeat(target, 'test', 'awake', describeFake)).rejects.toMatchObject({ reason: 'revoked' });
    // Still connected as a viewer.
    expect((await call('/api/computers', { bearer: laptopKey })).status).toBe(200);
  });
});

describe('This Mac', () => {
  it("links the computer's browser, once, with identity only", async () => {
    const target = await enrolledTarget();
    const issued = await call('/api/workers/me/associations', {
      method: 'POST',
      bearer: target.workerKey,
      headers: { 'x-ri-worker-protocol': '1' },
    });
    expect(issued.status).toBe(201);
    const code = issued.json!.code as string;

    const linked = await call('/api/devices/associate', { bearer: browserKey, body: { code } });
    expect(linked).toMatchObject({ status: 200, json: { computer: { id: laptopComputerId, name: 'MacBook' } } });
    const q = await import('@/lib/db/queries');
    const { hashToken } = await import('@/lib/auth/tokens');
    const browser = q.findApiKeyByHash(hashToken(browserKey))!;
    expect(browser.computerId).toBe(laptopComputerId);
    expect(q.isWorkerApiKey(browser.id)).toBe(false);
    expect(await call('/api/devices/associate', { bearer: browserKey, body: { code } })).toMatchObject({ status: 410 });
  });
});

describe('reading an event stream', () => {
  it('handles split chunks, CRLF, comments and multi-line data', async () => {
    const { readEventStream } = await import('@/lib/worker/sse');
    const parts = [': comment\r\nevent: hel', 'lo\r\ndata: {"a":\r\ndata: 1}\r\n\r\n', 'data: plain\n\n'];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const p of parts) controller.enqueue(new TextEncoder().encode(p));
        controller.close();
      },
    });
    const frames = [];
    for await (const frame of readEventStream(body)) frames.push(frame);
    expect(frames).toEqual([
      { event: 'hello', data: '{"a":\n1}' },
      { event: 'message', data: 'plain' },
    ]);
  });
});
