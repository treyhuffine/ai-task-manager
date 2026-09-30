/**
 * Salesforce OAuth2 connector. The harness drives
 * beginAuth→completeAuth against a fake token endpoint + identify, then runs a representative action.
 */
import { describe, it, expect } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { staticAuthConfigs } from '../auth-configs';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';
import type { FakeHttpCall } from '../testing';
import type { Registry } from '../core/registry';
import { registerSalesforce } from '../providers/salesforce';

function harness(providerId: string, register: (r: Registry, o: { fetch: typeof fetch }) => void, handler: (c: FakeHttpCall) => { status?: number; json?: unknown }) {
  const http = fakeHttp(async (c) => handler(c));
  const registry = createRegistry();
  register(registry, { fetch: http.fetch });
  const store = inMemoryStore();
  const runtime = createConnectorRuntime({
    registry,
    store,
    authRequests: store,
    secretBox: plaintextSecretBox(),
    authConfigs: staticAuthConfigs([
      { id: providerId, providerId, scheme: 'oauth2', scope: 'global', oauth: { clientId: 'c', redirectUri: 'http://127.0.0.1/cb' }, clientSecret: 's', status: 'active' },
    ]),
    redactor: createRedactor(),
    approval: { async check() { return 'allow'; } },
    fetch: http.fetch,
  });
  return { runtime };
}

async function connect(runtime: ReturnType<typeof harness>['runtime'], providerId: string) {
  const begin = await runtime.beginAuth(providerId, {});
  return runtime.completeAuth({ code: `code-${begin.requestId}`, state: begin.requestId });
}

describe('salesforce', () => {
  it('connects and runs SOQL against the per-instance URL', async () => {
    let queryUrl = '';
    const h = harness('salesforce', registerSalesforce, (c) => {
      if (c.url.includes('login.salesforce.com/services/oauth2/token')) return { json: { access_token: 'AT', instance_url: 'https://x.my.salesforce.com' } };
      if (c.url.endsWith('/services/oauth2/userinfo')) return { json: { user_id: 'U1', name: 'Ann' } };
      if (c.url.includes('/services/data/')) {
        queryUrl = c.url;
        return { json: { totalSize: 1, records: [{ Id: '001' }], done: true } };
      }
      return { json: {} };
    });
    const conn = await connect(h.runtime, 'salesforce');
    // instance_url captured as the connection base; identify resolved the user against it.
    expect(conn.accountId).toBe('U1');
    expect(conn.baseUrl).toBe('https://x.my.salesforce.com');
    const out = await h.runtime.runAction('salesforce.soql_query', { soql: 'SELECT Id FROM Account' });
    expect((out as { result: { totalSize: number } }).result.totalSize).toBe(1);
    expect(queryUrl.startsWith('https://x.my.salesforce.com/services/data/')).toBe(true);
  });
});
