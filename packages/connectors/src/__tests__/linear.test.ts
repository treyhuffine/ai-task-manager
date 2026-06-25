/**
 * Linear connector — OAuth2 connect + GraphQL action routing (the viewer identify, an issue
 * list, and a mutating create). Uses a fake GraphQL backend keyed off the query string.
 */
import { describe, it, expect } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { staticAuthConfigs } from '../auth-configs';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';
import { registerLinear } from '../providers/linear';

function setup() {
  const http = fakeHttp(async (call) => {
    if (call.url.startsWith('https://api.linear.app/oauth/token')) {
      return { json: { access_token: 'AT', token_type: 'Bearer', scope: 'read write issues:create' } };
    }
    if (call.url.endsWith('/graphql')) {
      const body = JSON.parse(call.body ?? '{}') as { query?: string };
      const q = body.query ?? '';
      if (q.includes('viewer')) return { json: { data: { viewer: { id: 'u1', name: 'Me', email: 'me@x.com' } } } };
      if (q.includes('issues(')) return { json: { data: { issues: { nodes: [{ id: 'i1', identifier: 'ENG-1', title: 'Bug', state: { name: 'Todo' } }] } } } };
      if (q.includes('issueCreate')) return { json: { data: { issueCreate: { success: true, issue: { id: 'i2', identifier: 'ENG-2', url: 'http://l/ENG-2' } } } } };
      return { json: { data: {} } };
    }
    return { json: {} };
  });
  const registry = createRegistry();
  registerLinear(registry, { fetch: http.fetch });
  const store = inMemoryStore();
  const runtime = createConnectorRuntime({
    registry,
    store,
    authRequests: store,
    secretBox: plaintextSecretBox(),
    authConfigs: staticAuthConfigs([
      { id: 'linear', providerId: 'linear', scheme: 'oauth2', scope: 'global', oauth: { clientId: 'c', redirectUri: 'http://127.0.0.1/cb' }, clientSecret: 's', status: 'active' },
    ]),
    redactor: createRedactor(),
    approval: { async check() { return 'allow'; } },
    fetch: http.fetch,
  });
  return { runtime, http };
}

async function connect(runtime: ReturnType<typeof setup>['runtime']) {
  const begin = await runtime.beginAuth('linear', { scopes: ['read', 'write', 'issues:create'] });
  return runtime.completeAuth({ code: 'code', state: begin.requestId });
}

describe('linear', () => {
  it('connects via OAuth and identifies the viewer', async () => {
    const s = setup();
    const conn = await connect(s.runtime);
    expect(conn.accountId).toBe('u1');
    expect(conn.email).toBe('me@x.com');
  });

  it('lists issues', async () => {
    const s = setup();
    await connect(s.runtime);
    const out = await s.runtime.runAction('linear.list_issues', {});
    expect(out.ok).toBe(true);
    expect((out as { result: { issues: Array<{ identifier: string }> } }).result.issues[0]).toMatchObject({ identifier: 'ENG-1' });
  });

  it('creates an issue (mutating, allowed)', async () => {
    const s = setup();
    await connect(s.runtime);
    const out = await s.runtime.runAction('linear.create_issue', { teamId: 't1', title: 'New' });
    expect(out.ok).toBe(true);
    expect((out as { result: { identifier: string } }).result).toMatchObject({ identifier: 'ENG-2' });
  });
});
