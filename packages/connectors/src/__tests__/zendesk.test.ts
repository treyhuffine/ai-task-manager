/**
 * Zendesk connector — proves the `custom` strategy rewrites the host to the connection's
 * subdomain and sets HTTP Basic auth (email/token), plus ticket reads/writes. Connected via
 * connectDirect with a custom (subdomain/email/api_token) credential.
 */
import { describe, it, expect } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { registerZendesk } from '../providers/zendesk';
import { staticAuthConfigs } from '../auth-configs';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';
import type { FakeHttpCall } from '../testing';

function setup() {
  const calls: FakeHttpCall[] = [];
  const http = fakeHttp(async (call) => {
    calls.push(call);
    if (call.url.includes('/users/me.json')) return { json: { user: { id: 55, email: 'agent@acme.com', name: 'Agent' } } };
    if (call.url.includes('/tickets.json') && call.method === 'GET') return { json: { tickets: [{ id: 1, subject: 'Help', status: 'open' }] } };
    if (call.url.includes('/tickets.json') && call.method === 'POST') return { json: { ticket: { id: 2, subject: 'New', status: 'new' } } };
    if (call.url.includes('/search.json')) return { json: { results: [{ id: 1 }], count: 1 } };
    return { json: { ticket: { id: 1 } } };
  });
  const registry = createRegistry();
  registerZendesk(registry);
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

const CRED = { type: 'custom' as const, values: { subdomain: 'acme', email: 'agent@acme.com', api_token: 'TOK' } };

describe('zendesk', () => {
  it('connects: rewrites host to the subdomain, sets Basic auth, identifies the agent', async () => {
    const s = setup();
    const conn = await s.runtime.connectDirect('zendesk', { credential: CRED });
    expect(conn.accountId).toBe('55');
    expect(conn.email).toBe('agent@acme.com');
    const me = s.calls.find((c) => c.url.includes('/users/me.json'));
    expect(me?.url).toBe('https://acme.zendesk.com/api/v2/users/me.json'); // host rewritten
    expect(me?.headers.authorization).toBe(`Basic ${Buffer.from('agent@acme.com/token:TOK').toString('base64')}`);
  });

  it('lists and creates tickets', async () => {
    const s = setup();
    await s.runtime.connectDirect('zendesk', { credential: CRED });
    const list = await s.runtime.runAction('zendesk.list_tickets', {});
    expect(list.ok).toBe(true);
    expect((list as { result: { tickets: unknown[] } }).result.tickets).toHaveLength(1);

    const created = await s.runtime.runAction('zendesk.create_ticket', { subject: 'New', body: 'please help' });
    expect(created.ok).toBe(true);
    expect((created as { result: { id: number } }).result.id).toBe(2);
    const post = s.calls.find((c) => c.method === 'POST' && c.url.includes('/tickets.json'));
    expect(JSON.parse(post?.body as string)).toMatchObject({ ticket: { subject: 'New', comment: { body: 'please help' } } });
  });
});
