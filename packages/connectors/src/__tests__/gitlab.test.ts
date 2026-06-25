/**
 * GitLab connector — PAT (bearer) via connectDirect. Proves identify() + the Bearer header and
 * a couple of read/write actions against a mock.
 */
import { describe, it, expect } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { registerGitlab } from '../providers/gitlab';
import { staticAuthConfigs } from '../auth-configs';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';
import type { FakeHttpCall } from '../testing';

function setup() {
  const calls: FakeHttpCall[] = [];
  const http = fakeHttp(async (call) => {
    calls.push(call);
    if (call.url.endsWith('/user')) return { json: { id: 7, username: 'dev', email: 'd@x.com', name: 'Dev' } };
    if (call.url.includes('/projects')) {
      return { json: [{ id: 1, name: 'p', path_with_namespace: 'g/p', web_url: 'https://x' }] };
    }
    return { json: [] };
  });
  const registry = createRegistry();
  registerGitlab(registry);
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

describe('gitlab', () => {
  it('connects via PAT and identifies the user', async () => {
    const s = setup();
    const conn = await s.runtime.connectDirect('gitlab', { credential: { type: 'bearer', token: 'PAT' } });
    expect(conn.accountId).toBe('7');
    expect(conn.email).toBe('d@x.com');
    expect(s.calls.find((c) => c.url.endsWith('/user'))?.headers.authorization).toBe('Bearer PAT');
  });

  it('lists projects', async () => {
    const s = setup();
    await s.runtime.connectDirect('gitlab', { credential: { type: 'bearer', token: 'PAT' } });
    const out = await s.runtime.runAction('gitlab.list_projects', {});
    expect(out.ok).toBe(true);
    expect((out as { result: { projects: Array<{ path: string }> } }).result.projects[0]?.path).toBe('g/p');
  });

  it('creates an issue (mutating)', async () => {
    const s = setup();
    await s.runtime.connectDirect('gitlab', { credential: { type: 'bearer', token: 'PAT' } });
    const out = await s.runtime.runAction('gitlab.create_issue', { id: 1, title: 'bug' });
    expect(out.ok).toBe(true);
    const post = s.calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe('https://gitlab.com/api/v4/projects/1/issues');
  });
});
