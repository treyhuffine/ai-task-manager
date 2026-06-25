/**
 * Plaid connector — the `custom` strategy injects client_id/secret into the JSON body. Proves
 * body-injected auth end to end: the request body carries the action input PLUS the credentials.
 */
import { describe, it, expect } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { registerPlaid } from '../providers/plaid';
import { staticAuthConfigs } from '../auth-configs';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';
import type { FakeHttpCall } from '../testing';

function setup(handler: (c: FakeHttpCall) => { status?: number; json?: unknown }) {
  const http = fakeHttp(async (c) => handler(c));
  const registry = createRegistry();
  registerPlaid(registry);
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

describe('plaid', () => {
  it('connects with a custom credential and injects client_id/secret into the body', async () => {
    let body: Record<string, unknown> | undefined;
    const s = setup((c) => {
      body = c.body ? JSON.parse(c.body) : undefined;
      return { json: { accounts: [{ account_id: 'acc1' }], item: { item_id: 'it1' } } };
    });
    await s.runtime.connectDirect('plaid', { credential: { type: 'custom', values: { client_id: 'CID', secret: 'SEC' } } });
    const out = await s.runtime.runAction('plaid.get_accounts', { access_token: 'access-sandbox-1' });
    expect(out.ok).toBe(true);
    expect((out as { result: { accounts: unknown[] } }).result.accounts).toHaveLength(1);
    // The body carries the action input AND the injected credentials.
    expect(body).toEqual({ access_token: 'access-sandbox-1', client_id: 'CID', secret: 'SEC' });
  });

  it('confines the custom secret (never escapes to a result)', async () => {
    const s = setup(() => ({ json: { accounts: [], leaked: 'SEC' } }));
    await s.runtime.connectDirect('plaid', { credential: { type: 'custom', values: { client_id: 'CID', secret: 'SEC' } } });
    const out = await s.runtime.runAction('plaid.get_balance', { access_token: 'at' });
    expect(JSON.stringify(out)).not.toContain('SEC'); // redactor scrubs the registered secret
  });
});
