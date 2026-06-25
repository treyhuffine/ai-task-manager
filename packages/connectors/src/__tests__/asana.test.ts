/**
 * Asana connector — bearer PAT via connectDirect, identify() from `/users/me`, and the `{ data }`
 * envelope unwrapping in the toolkit mappers.
 */
import { describe, it, expect } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { registerAsana } from '../providers/asana';
import { staticAuthConfigs } from '../auth-configs';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';
import type { FakeHttpCall } from '../testing';

function setup() {
  const calls: FakeHttpCall[] = [];
  const http = fakeHttp(async (call) => {
    calls.push(call);
    if (call.url.endsWith('/users/me')) return { json: { data: { gid: '42', name: 'Ada', email: 'ada@x.dev' } } };
    if (call.url.includes('/tasks/')) return { json: { data: { gid: 't1', name: 'Task', completed: false } } };
    if (call.url.includes('/tasks')) return { json: { data: [{ gid: 't1', name: 'Task' }] } };
    if (call.url.includes('/projects')) return { json: { data: [{ gid: 'p1', name: 'Proj' }] } };
    if (call.url.includes('/workspaces')) return { json: { data: [{ gid: 'w1', name: 'WS' }] } };
    return { json: { data: {} } };
  });
  const registry = createRegistry();
  registerAsana(registry);
  const store = inMemoryStore();
  const runtime = createConnectorRuntime({
    registry,
    store,
    authRequests: store,
    secretBox: plaintextSecretBox(),
    authConfigs: staticAuthConfigs([]),
    redactor: createRedactor(),
    approval: { async check() { return 'allow'; } },
    fetch: http.fetch,
  });
  return { runtime, store, http, calls };
}

describe('asana', () => {
  it('connects via PAT and identifies the user from /users/me', async () => {
    const s = setup();
    const conn = await s.runtime.connectDirect('asana', { credential: { type: 'bearer', token: 'PAT' } });
    expect(conn.accountId).toBe('42');
    expect(conn.email).toBe('ada@x.dev');
    expect(conn.label).toBe('Ada');
    const me = s.calls.find((c) => c.url.endsWith('/users/me'));
    expect(me?.headers.authorization).toBe('Bearer PAT');
  });

  it('list_tasks unwraps the { data } envelope', async () => {
    const s = setup();
    await s.runtime.connectDirect('asana', { credential: { type: 'bearer', token: 'PAT' } });
    const out = await s.runtime.runAction('asana.list_tasks', { assignee: 'me', workspace: 'w1' });
    expect(out.ok).toBe(true);
    expect((out as { result: { tasks: Array<{ gid: string }> } }).result.tasks).toEqual([{ gid: 't1', name: 'Task' }]);
  });

  it('create_task posts under the { data } envelope (mutating)', async () => {
    const s = setup();
    await s.runtime.connectDirect('asana', { credential: { type: 'bearer', token: 'PAT' } });
    const out = await s.runtime.runAction('asana.create_task', { name: 'New', workspace: 'w1', projects: ['p1'] });
    expect(out.ok).toBe(true);
    const post = s.calls.find((c) => c.method === 'POST' && c.url.endsWith('/tasks'));
    expect(JSON.parse(post?.body as string)).toEqual({ data: { name: 'New', workspace: 'w1', projects: ['p1'] } });
  });
});
