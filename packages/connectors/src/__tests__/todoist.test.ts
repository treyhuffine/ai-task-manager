/**
 * Todoist connector — API-key connect (connectDirect) + actions over a fake REST backend.
 */
import { describe, it, expect } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { registerTodoist } from '../providers/todoist';
import { staticAuthConfigs } from '../auth-configs';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';
import type { FakeHttpCall } from '../testing';

function setup() {
  const calls: FakeHttpCall[] = [];
  const http = fakeHttp(async (call) => {
    calls.push(call);
    if (call.url.includes('/tasks/') && call.url.endsWith('/close')) return { status: 204 };
    if (call.url.endsWith('/tasks') && call.method === 'GET') {
      return { json: [{ id: '1', content: 'Buy milk', priority: 1, project_id: 'p1', is_completed: false }] };
    }
    if (call.url.endsWith('/tasks') && call.method === 'POST') return { json: { id: '2', content: 'New', priority: 1 } };
    if (call.url.endsWith('/projects')) return { json: [{ id: 'p1', name: 'Inbox' }] };
    return { json: {} };
  });
  const registry = createRegistry();
  registerTodoist(registry);
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

describe('todoist', () => {
  it('connects via API key (Bearer) and lists tasks', async () => {
    const s = setup();
    const conn = await s.runtime.connectDirect('todoist', { credential: { type: 'api_key', apiKey: 'TOKEN' } });
    expect(conn.providerId).toBe('todoist');
    const out = await s.runtime.runAction('todoist.list_tasks', {});
    expect(out.ok).toBe(true);
    expect((out as { result: { tasks: Array<{ id: string; content: string }> } }).result.tasks[0]).toMatchObject({
      id: '1',
      content: 'Buy milk',
    });
    const taskCall = s.calls.find((c) => c.url.endsWith('/tasks') && c.method === 'GET');
    expect(taskCall?.headers.authorization).toBe('Bearer TOKEN');
  });

  it('creates and completes tasks', async () => {
    const s = setup();
    await s.runtime.connectDirect('todoist', { credential: { type: 'api_key', apiKey: 'TOKEN' } });
    const created = await s.runtime.runAction('todoist.create_task', { content: 'New' });
    expect(created.ok).toBe(true);
    const closed = await s.runtime.runAction('todoist.complete_task', { id: '2' });
    expect(closed).toMatchObject({ ok: true, result: { completed: true } });
  });

  it('lists projects', async () => {
    const s = setup();
    await s.runtime.connectDirect('todoist', { credential: { type: 'api_key', apiKey: 'TOKEN' } });
    const out = await s.runtime.runAction('todoist.list_projects', {});
    expect((out as { result: { projects: Array<{ name: string }> } }).result.projects[0]?.name).toBe('Inbox');
  });
});
