/**
 * Calendly / Raindrop / Zoom / HubSpot / Salesforce — OAuth2 connectors. One shared harness drives
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
import { registerCalendly } from '../providers/calendly';
import { registerRaindrop } from '../providers/raindrop';
import { registerZoom } from '../providers/zoom';
import { registerHubspot } from '../providers/hubspot';
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

describe('calendly', () => {
  it('connects and gets the current user', async () => {
    const h = harness('calendly', registerCalendly, (c) => {
      if (c.url.includes('auth.calendly.com/oauth/token')) return { json: { access_token: 'AT' } };
      if (c.url.endsWith('/users/me')) return { json: { resource: { uri: 'https://api.calendly.com/users/U1', name: 'Ann', email: 'a@x.com' } } };
      return { json: {} };
    });
    const conn = await connect(h.runtime, 'calendly');
    expect(conn.accountId).toBe('https://api.calendly.com/users/U1');
    const out = await h.runtime.runAction('calendly.get_current_user', {});
    expect(out).toMatchObject({ ok: true, result: { name: 'Ann' } });
  });
});

describe('raindrop', () => {
  it('connects and lists collections', async () => {
    const h = harness('raindrop', registerRaindrop, (c) => {
      if (c.url.includes('raindrop.io/oauth/access_token')) return { json: { access_token: 'AT' } };
      if (c.url.endsWith('/user')) return { json: { user: { _id: 123, email: 'a@x.com', fullName: 'Ann' } } };
      if (c.url.endsWith('/collections')) return { json: { items: [{ _id: 1, title: 'Read later' }] } };
      return { json: {} };
    });
    const conn = await connect(h.runtime, 'raindrop');
    expect(conn.accountId).toBe('123');
    const out = await h.runtime.runAction('raindrop.list_collections', {});
    expect((out as { result: { items: unknown[] } }).result.items).toHaveLength(1);
  });
});

describe('zoom', () => {
  it('connects (basic token auth) and lists meetings', async () => {
    const h = harness('zoom', registerZoom, (c) => {
      if (c.url.includes('zoom.us/oauth/token')) return { json: { access_token: 'AT' } };
      if (c.url.endsWith('/users/me')) return { json: { id: 'Z1', email: 'a@x.com', first_name: 'Ann' } };
      if (c.url.includes('/users/me/meetings')) return { json: { meetings: [{ id: 1, topic: 'Sync' }], total_records: 1 } };
      return { json: {} };
    });
    const conn = await connect(h.runtime, 'zoom');
    expect(conn.accountId).toBe('Z1');
    const out = await h.runtime.runAction('zoom.list_meetings', {});
    expect((out as { result: { total: number } }).result.total).toBe(1);
  });
});

describe('hubspot', () => {
  it('connects and lists contacts', async () => {
    const h = harness('hubspot', registerHubspot, (c) => {
      if (c.url.includes('api.hubapi.com/oauth/v1/token')) return { json: { access_token: 'AT' } };
      if (c.url.endsWith('/account-info/v3/details')) return { json: { portalId: 42 } };
      if (c.url.includes('/crm/v3/objects/contacts')) return { json: { results: [{ id: 'c1' }] } };
      return { json: {} };
    });
    const conn = await connect(h.runtime, 'hubspot');
    expect(conn.accountId).toBe('42');
    const out = await h.runtime.runAction('hubspot.list_contacts', {});
    expect((out as { result: { results: unknown[] } }).result.results).toHaveLength(1);
  });
});

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
