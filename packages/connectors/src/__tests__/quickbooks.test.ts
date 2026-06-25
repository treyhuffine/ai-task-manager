/**
 * QuickBooks connector (OAuth2 + per-company realmId). The realmId arrives on the OAuth callback,
 * so completeAuth passes it via `params`; identify binds it to the connection's config/accountId.
 * Exercises connect → a query through the absolute per-company URL built from the stored realmId.
 */
import { describe, it, expect } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { staticAuthConfigs } from '../auth-configs';
import { registerQuickbooks } from '../providers/quickbooks';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';

function setup() {
  const http = fakeHttp(async (call) => {
    if (call.url.startsWith('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer')) {
      return { json: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'openid offline_access com.intuit.quickbooks.accounting' } };
    }
    if (call.url.includes('/v3/company/R1/query')) {
      return { json: { QueryResponse: { Customer: [{ Id: '1', DisplayName: 'Acme' }] } } };
    }
    if (call.url.includes('/v3/company/R1/companyinfo/R1')) {
      return { json: { CompanyInfo: { CompanyName: 'Acme Inc' } } };
    }
    return { json: {} };
  });
  const registry = createRegistry();
  registerQuickbooks(registry, { fetch: http.fetch });
  const store = inMemoryStore();
  const runtime = createConnectorRuntime({
    registry,
    store,
    authRequests: store,
    secretBox: plaintextSecretBox(),
    authConfigs: staticAuthConfigs([
      { id: 'quickbooks', providerId: 'quickbooks', scheme: 'oauth2', scope: 'global', oauth: { clientId: 'c', redirectUri: 'http://127.0.0.1/cb' }, clientSecret: 's', status: 'active' },
    ]),
    redactor: createRedactor(),
    approval: { async check() { return 'allow'; } },
    fetch: http.fetch,
  });
  return { runtime, http };
}

describe('quickbooks connector', () => {
  it('binds the realmId from the callback and queries a company', async () => {
    const s = setup();
    const begin = await s.runtime.beginAuth('quickbooks', { scopes: ['com.intuit.quickbooks.accounting'] });
    const conn = await s.runtime.completeAuth({ code: `code-${begin.requestId}`, state: begin.requestId, params: { realmId: 'R1' } });
    expect(conn.accountId).toBe('R1');
    expect(conn.config).toEqual({ realmId: 'R1' }); // captured at connect from the callback — not an action input

    const out = await s.runtime.runAction('quickbooks.query', { query: 'SELECT * FROM Customer' });
    expect(out.ok).toBe(true);
    expect((out as { result: { Customer: Array<{ Id: string }> } }).result.Customer[0]).toMatchObject({ Id: '1', DisplayName: 'Acme' });
  });

  it('reads company info through the per-realm absolute URL', async () => {
    const s = setup();
    const begin = await s.runtime.beginAuth('quickbooks', { scopes: ['com.intuit.quickbooks.accounting'] });
    await s.runtime.completeAuth({ code: `code-${begin.requestId}`, state: begin.requestId, params: { realmId: 'R1' } });
    const out = await s.runtime.runAction('quickbooks.get_company_info', {});
    expect(out.ok).toBe(true);
    expect((out as { result: { CompanyName: string } }).result.CompanyName).toBe('Acme Inc');
  });

  it('testConnection uses the explicit healthCheck (real companyinfo read) → verified', async () => {
    const s = setup();
    const begin = await s.runtime.beginAuth('quickbooks', { scopes: ['com.intuit.quickbooks.accounting'] });
    const conn = await s.runtime.completeAuth({ code: `code-${begin.requestId}`, state: begin.requestId, params: { realmId: 'R1' } });
    // identify needs the realmId callback param it can't have at probe time; the healthCheck saves it.
    const res = await s.runtime.testConnection(conn.id);
    expect(res).toMatchObject({ ok: true, status: 'active', verified: true });
  });
});
