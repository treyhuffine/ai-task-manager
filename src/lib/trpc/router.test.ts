import { GET, POST } from '@/app/api/trpc/[trpc]/route';
import { ApiClient, apiErrorCode, apiErrorDetails, apiErrorText } from '@/lib/api/client';
import { apiErrorStatus } from '@/lib/api/error-status';
import * as q from '@/lib/db/queries';
import { resetHomeIdentityCache } from '@/lib/home/identity';
import { writeMaintenance } from '@/lib/service/maintenance';
import { TaskLifecycleError } from '@/lib/tasks/lifecycle';
import { proxy } from '@/proxy';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTRPCClient } from './client';
import { appRouter } from './router';

const runtime = vi.hoisted(() => ({ coordinate: vi.fn(async () => {}) }));
vi.mock('@/lib/sessions/workstream', () => ({ coordinateLifecycleChange: runtime.coordinate }));
vi.mock('@/lib/sessions/workstream-runtime', () => ({ inProcessWorkstreamRuntime: {} }));
vi.mock('@/lib/executor/status-snapshot', () => ({ listRunningSessions: () => [] }));

let home: TestHome;
let client: ReturnType<typeof createAppTRPCClient>;
let requests: NextRequest[];
let unauthorized: ReturnType<typeof vi.fn<() => void>>;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-trpc-' });
  process.env.RI_MIRROR_DISABLED = '1';
  resetHomeIdentityCache();
  const token = q.pairDevice({ name: 'Viewer', kind: 'phone' }).token.plaintext;
  requests = [];
  unauthorized = vi.fn();
  runtime.coordinate.mockReset().mockResolvedValue(undefined);
  client = createAppTRPCClient({ url: 'http://local.test/api/trpc', transport: new ApiClient({ getToken: () => token, onUnauthorized: unauthorized }) });
  // Exercise the real tRPC wire format, route adapter and authentication
  // proxy, without opening sockets or reaching a running Home.
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const request = new NextRequest(url, { ...init, signal: init?.signal ?? undefined });
    requests.push(request);
    const auth = proxy(request);
    if (auth.headers.get('x-middleware-next') !== '1') return auth;
    const headers = new Headers(request.headers);
    for (const [name, value] of auth.headers) {
      if (name.startsWith('x-middleware-request-')) headers.set(name.slice('x-middleware-request-'.length), value);
    }
    const forwarded = new Request(request, { headers });
    return request.method === 'GET' ? GET(forwarded) : POST(forwarded);
  });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  resetHomeIdentityCache();
  await home.cleanup();
});

describe('typed UI API over the authenticated HTTP adapter', () => {
  it('round-trips hydrated records and batches independent reads with compact list DTOs', async () => {
    const area = await client.areas.create.mutate({ name: 'Work' });
    const task = await client.tasks.create.mutate({ title: 'Ship', rawInput: 'Ship', areaId: area.id, body: 'a'.repeat(600), contextTags: ['work'] });
    const note = await client.notes.create.mutate({ body: 'Original', taskId: task.id });
    const before = requests.length;
    const [tasks, notes, counts] = await Promise.all([
      client.tasks.list.query({ areaId: area.id }), client.notes.list.query({ taskId: task.id }), client.tasks.counts.query({ areaId: area.id }),
    ]);
    expect(requests.length - before).toBe(1);
    expect(tasks[0]).toMatchObject({ id: task.id, bodyLen: 600, bodyExcerpt: 'a'.repeat(300) });
    expect(tasks[0]).not.toHaveProperty('body');
    expect(notes[0]).not.toHaveProperty('body');
    expect(counts.todo).toBe(1);
    expect(await client.tasks.get.query({ id: task.id })).toMatchObject({ body: 'a'.repeat(600) });
    expect(q.getTask(task.id)?.lastViewedAt).toBeTruthy();
    expect(await client.notes.update.mutate({ id: note.id, patch: { body: '# Verbatim\n\nText  ' } })).toMatchObject({ body: '# Verbatim\n\nText  ' });
    expect(await client.areas.update.mutate({ id: area.id, patch: { description: 'Updated' } })).toMatchObject({ description: 'Updated' });
    for (const req of requests) {
      expect(req.headers.get('authorization')).toMatch(/^Bearer /);
      expect(req.headers.get('x-ri-api-protocol')).toBe('1');
    }
  });

  it('validates writes before effects, rejects lifecycle field bypasses, and preserves nullable patches', async () => {
    const task = q.createTask({ title: 'Before', rawInput: 'Before' });
    const call = appRouter.createCaller({ request: new Request('http://localhost/api/trpc'), key: { apiKeyId: 'viewer', scope: 'viewer', location: 'home', workerDeviceId: null, sessionChatId: null } });
    await expect(call.tasks.create({ title: '', rawInput: 'x' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    // An untyped HTTP caller cannot bypass the compile-time contract.
    await expect(call.tasks.update({ id: task.id, patch: { status: 'done' } as never })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(call.tasks.update({ id: task.id, patch: { statusChangedCount: 99 } as never })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(q.getTask(task.id)).toMatchObject({ title: 'Before', status: 'todo', statusChangedCount: 0 });
    await client.tasks.update.mutate({ id: task.id, patch: { areaId: null, body: null } });
    expect(q.getTask(task.id)).toMatchObject({ areaId: null, body: null });
  });

  it('preserves semantic lifecycle, idempotent replays and actionable conflict details', async () => {
    const task = q.createTask({ title: 'Lifecycle', rawInput: 'Lifecycle' });
    await client.tasks.transition.mutate({ id: task.id, command: 'start', idempotencyKey: 'start', expectedStatusChangedCount: 0 });
    runtime.coordinate.mockRejectedValueOnce(new TaskLifecycleError('active_execution', 'Choose what happens to the running agent', { requiresChoice: true, executions: [{ id: 'running' }] }));
    let conflict: unknown;
    try { await client.tasks.complete.mutate({ id: task.id, idempotencyKey: 'complete', expectedStatusChangedCount: 1 }); } catch (err) { conflict = err; }
    expect(apiErrorCode(conflict)).toBe('active_execution');
    expect(apiErrorStatus(conflict)).toBe(409);
    expect(apiErrorDetails(conflict)).toMatchObject({ requiresChoice: true });
    expect(apiErrorText(conflict)).toBe('Choose what happens to the running agent');
    const result = await client.tasks.complete.mutate({ id: task.id, idempotencyKey: 'complete', expectedStatusChangedCount: 1, runtimeChoice: 'keep_running' });
    const calls = runtime.coordinate.mock.calls.length;
    expect(result).toMatchObject({ toStatus: 'done', replayed: false });
    expect(await client.tasks.complete.mutate({ id: task.id, idempotencyKey: 'complete', expectedStatusChangedCount: 1 })).toMatchObject({ replayed: true, statusChangedCount: result.statusChangedCount });
    expect(runtime.coordinate).toHaveBeenCalledTimes(calls);
  });

  it('rejects a stale lifecycle command before coordinating a running workstream', async () => {
    const task = q.createTask({ title: 'Stale', rawInput: 'Stale' });
    await client.tasks.transition.mutate({ id: task.id, command: 'start', idempotencyKey: 'start' });
    await expect(client.tasks.transition.mutate({ id: task.id, command: 'archive', expectedStatusChangedCount: 0 })).rejects.toMatchObject({ data: { domainCode: 'conflict', httpStatus: 409 } });
    expect(runtime.coordinate).not.toHaveBeenCalled();
  });

  it('requires an open-child acknowledgement before runtime coordination', async () => {
    const parent = q.createTask({ title: 'Parent', rawInput: 'Parent' });
    const child = q.createTask({ title: 'Child', rawInput: 'Child', parentId: parent.id });
    await expect(client.tasks.complete.mutate({ id: parent.id, idempotencyKey: 'children' })).rejects.toMatchObject({ data: { domainCode: 'conflict', details: { requiresChildAck: true } } });
    expect(runtime.coordinate).not.toHaveBeenCalled();
    expect(await client.tasks.complete.mutate({ id: parent.id, idempotencyKey: 'children', acknowledgedChildIds: [child.id] })).toMatchObject({ toStatus: 'done' });
    expect(runtime.coordinate).toHaveBeenCalledOnce();
  });

  it('supports the full attention batch, recurring completion, deletion and stable missing-record errors', async () => {
    const task = q.createTask({ title: 'Repeat', rawInput: 'Repeat', recurrence: 'FREQ=DAILY' });
    const ids = [task.id, ...Array.from({ length: 199 }, () => crypto.randomUUID())];
    expect(await client.tasks.attention.query({ ids })).toHaveProperty(task.id);
    expect(await client.tasks.complete.mutate({ id: task.id, idempotencyKey: 'once', expectedStatusChangedCount: 0 })).toMatchObject({ recurring: true, toStatus: 'todo' });
    const note = await client.notes.create.mutate({ body: 'Delete me' });
    await client.notes.delete.mutate({ id: note.id });
    await expect(client.notes.get.query({ id: note.id })).rejects.toMatchObject({ data: { httpStatus: 404 } });
    await client.tasks.delete.mutate({ id: task.id });
    await expect(client.tasks.get.query({ id: task.id })).rejects.toMatchObject({ data: { httpStatus: 404 } });
  });

  it('allows document saves and reads while draining, rejects new work and all offline access', async () => {
    const task = q.createTask({ title: 'Before', rawInput: 'Before' });
    const note = q.createNote({ body: 'Before' });
    writeMaintenance({ phase: 'draining', token: 'test', startedAt: new Date().toISOString() });
    await Promise.all([
      client.tasks.update.mutate({ id: task.id, patch: { title: 'Saved' } }),
      client.notes.update.mutate({ id: note.id, patch: { body: 'Saved' } }),
    ]);
    expect(await client.tasks.get.query({ id: task.id })).toMatchObject({ title: 'Saved' });
    await expect(client.tasks.create.mutate({ title: 'New work', rawInput: 'x' })).rejects.toMatchObject({ data: { httpStatus: 503 } });
    writeMaintenance({ phase: 'offline', token: 'test', startedAt: new Date().toISOString() });
    await expect(client.tasks.update.mutate({ id: task.id, patch: { title: 'Blocked' } })).rejects.toMatchObject({ data: { httpStatus: 503 } });
    await expect(client.tasks.get.query({ id: task.id })).rejects.toMatchObject({ data: { httpStatus: 503 } });
    expect(q.getTask(task.id)?.title).toBe('Saved');
  });


  it('round-trips workspace, chat, reference, device and settings contracts over the real adapter', async () => {
    const ws = q.createWorkspace({ name: 'Typed agent', cwd: home.root, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
    const { session } = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'Contract chat' });
    const params = { id: session.id };
    expect(await client.workspaces.update.mutate({ params: { id: ws.id }, body: { purpose: 'Review code' } })).toMatchObject({ purpose: 'Review code' });
    expect(await client.sessions.get.query({ params })).toMatchObject({ id: session.id, harness: 'claude', workspaceId: ws.id });
    const text = '# Local draft\n\nKeep spacing  ';
    expect(await client.sessions.scratchpadPut.mutate({ params, body: { scratchPad: text } })).toEqual({ scratchPad: text });
    expect(await client.sessions.scratchpadGet.query({ params })).toEqual({ scratchPad: text });
    q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', content: 'Typed transcript', raw: { large: 'x'.repeat(5000) }, createdAt: new Date().toISOString() });
    const events = await client.sessions.eventsGet.query({ params, query: { limit: '1' } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ content: 'Typed transcript', sessionId: session.id });
    expect(events[0]).toHaveProperty('raw', null);
    const reference = await client.referenceFolders.create.mutate({ body: { alias: 'docs', path: home.root, workspaceId: ws.id } });
    expect(reference).toMatchObject({ alias: 'docs' });
    expect(await client.referenceFolders.list.query({ query: { workspaceId: ws.id } })).toEqual(expect.arrayContaining([expect.objectContaining({ alias: 'docs' })]));
    const paired = await client.devices.create.mutate({ body: { name: 'Native viewer', kind: 'phone' } });
    expect(paired.plaintext).toBeTruthy();
    expect(await client.devices.update.mutate({ params: { id: paired.device.id }, body: { name: 'Renamed phone' } })).toMatchObject({ name: 'Renamed phone' });
    expect(await client.connectors.requestSettingsPatch.mutate({ body: { requestsEnabled: false } })).toEqual({ requestsEnabled: false });
    expect(await client.connectors.requestSettingsGet.query({})).toEqual({ requestsEnabled: false });
    expect(await client.home.info.query({})).toMatchObject({ id: expect.any(String), host: { id: expect.any(String) } });
  });

  it('keeps scoped missing-resource and native validation failures typed before effects', async () => {
    const before = q.listWorkspaces().length;
    await expect(client.workspaces.create.mutate({ body: { name: 'Unsafe', cwd: home.root, browserEnabled: 'yes' } as never })).rejects.toMatchObject({ data: { httpStatus: 400 } });
    expect(q.listWorkspaces()).toHaveLength(before);
    await expect(client.sessions.scratchpadPut.mutate({ params: { id: 'missing' }, body: { scratchPad: 'retained' } })).rejects.toMatchObject({ data: { httpStatus: 404, body: { error: 'Session not found' } } });
    await expect(client.service.awakeGet.query({})).rejects.toMatchObject({ data: { httpStatus: 403 } });
  });

  it('gates development procedures inside the router in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      await expect(client.dev.scratch.query({})).rejects.toMatchObject({ data: { httpStatus: 404 } });
      await expect(client.dev.inject.mutate({ params: { id: 'missing' }, body: { kind: 'reset_session' } })).rejects.toMatchObject({ data: { httpStatus: 404 } });
    } finally { vi.unstubAllEnvs(); }
  });

  it('does not give unauthenticated, worker or session callers the UI API', async () => {
    for (const scope of ['worker', 'session'] as const) {
      const call = appRouter.createCaller({ request: new Request('http://localhost/api/trpc'), key: { apiKeyId: 'scoped', scope, location: 'elsewhere', workerDeviceId: 'device', sessionChatId: 'session' } });
      await expect(call.tasks.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await expect(appRouter.createCaller({ request: new Request('http://localhost/api/trpc'), key: null }).tasks.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const rejected = proxy(new NextRequest('http://local.test/api/trpc/tasks.list', { headers: { 'x-ri-api-key-id': 'forged' } }));
    expect(rejected.status).toBe(401);
  });
});
