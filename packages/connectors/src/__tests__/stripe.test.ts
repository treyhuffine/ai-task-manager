/** Stripe connector — secret-key connect (identify /account), reads, and a form-encoded write. */
import { describe, it, expect } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { registerStripe } from '../providers/stripe';
import { staticAuthConfigs } from '../auth-configs';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';
import type { FakeHttpCall } from '../testing';

function setup(handler: (c: FakeHttpCall) => { status?: number; json?: unknown }) {
  const http = fakeHttp(async (c) => handler(c));
  const registry = createRegistry();
  registerStripe(registry);
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
  return { runtime };
}

describe('stripe', () => {
  it('connects with a secret key (identify /account) and lists customers', async () => {
    let auth: string | undefined;
    const s = setup((c) => {
      auth = c.headers.authorization;
      if (c.url.endsWith('/account')) return { json: { id: 'acct_1', email: 'biz@x.com' } };
      if (c.url.includes('/customers')) return { json: { data: [{ id: 'cus_1' }], has_more: false } };
      return { json: {} };
    });
    const conn = await s.runtime.connectDirect('stripe', { credential: { type: 'bearer', token: 'sk_test_123' } });
    expect(conn.accountId).toBe('acct_1');
    const out = await s.runtime.runAction('stripe.list_customers', { limit: 5 });
    expect(out.ok).toBe(true);
    expect((out as { result: { data: Array<{ id: string }> } }).result.data[0]?.id).toBe('cus_1');
    expect(auth).toBe('Bearer sk_test_123');
  });

  it('creates a customer with a form-encoded body', async () => {
    let body: string | undefined;
    let contentType: string | undefined;
    const s = setup((c) => {
      if (c.url.endsWith('/account')) return { json: { id: 'acct_1' } };
      body = c.body;
      contentType = c.headers['content-type'];
      return { json: { id: 'cus_new' } };
    });
    await s.runtime.connectDirect('stripe', { credential: { type: 'bearer', token: 'sk' } });
    const out = await s.runtime.runAction('stripe.create_customer', { email: 'a@b.com', name: 'Ann' });
    expect(out).toMatchObject({ ok: true, result: { id: 'cus_new' } });
    expect(contentType).toContain('application/x-www-form-urlencoded');
    expect(body).toBe('email=a%40b.com&name=Ann');
  });
});
