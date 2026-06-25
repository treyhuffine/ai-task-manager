/**
 * Salesforce connector (OAuth2 + per-org instance_url). The token response carries `instance_url`;
 * resolveBaseUrl captures it as the connection baseUrl, identify reads /services/oauth2/userinfo
 * against it, and every action uses a RELATIVE Data API path resolved against that org host — so
 * the instance URL is never an action input.
 */
import { describe, it, expect } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { staticAuthConfigs } from '../auth-configs';
import { registerSalesforce } from '../providers/salesforce';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';

const INSTANCE = 'https://myorg.my.salesforce.com';

function setup() {
  const calls: string[] = [];
  const http = fakeHttp(async (call) => {
    calls.push(call.url);
    if (call.url.startsWith('https://login.salesforce.com/services/oauth2/token')) {
      return { json: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'api refresh_token', instance_url: INSTANCE } };
    }
    if (call.url === `${INSTANCE}/services/oauth2/userinfo`) {
      return { json: { user_id: 'U1', email: 'me@org.com', name: 'Me Org' } };
    }
    if (call.url.startsWith(`${INSTANCE}/services/data/v59.0/query`)) {
      return { json: { totalSize: 1, done: true, records: [{ Id: '001', Name: 'Acme' }] } };
    }
    if (call.url.startsWith(`${INSTANCE}/services/data/v59.0/sobjects/Account`)) {
      return { json: { id: '001', success: true } };
    }
    return { json: {} };
  });
  const registry = createRegistry();
  registerSalesforce(registry, { fetch: http.fetch });
  const store = inMemoryStore();
  const runtime = createConnectorRuntime({
    registry,
    store,
    authRequests: store,
    secretBox: plaintextSecretBox(),
    authConfigs: staticAuthConfigs([
      { id: 'salesforce', providerId: 'salesforce', scheme: 'oauth2', scope: 'global', oauth: { clientId: 'c', redirectUri: 'http://127.0.0.1/cb' }, clientSecret: 's', status: 'active' },
    ]),
    redactor: createRedactor(),
    approval: { async check() { return 'allow'; } },
    fetch: http.fetch,
  });
  return { runtime, calls };
}

describe('salesforce connector', () => {
  it('captures instance_url as the connection base, identifies the user, and queries it', async () => {
    const s = setup();
    const begin = await s.runtime.beginAuth('salesforce', { scopes: [] });
    const conn = await s.runtime.completeAuth({ code: `code-${begin.requestId}`, state: begin.requestId });
    expect(conn.baseUrl).toBe(INSTANCE); // captured from the token response
    expect(conn.accountId).toBe('U1');
    expect(conn.label).toBe('Me Org');
    // identify ran against the org instance, not login.salesforce.com:
    expect(s.calls).toContain(`${INSTANCE}/services/oauth2/userinfo`);

    const out = await s.runtime.runAction('salesforce.soql_query', { soql: 'SELECT Id, Name FROM Account' });
    expect(out.ok).toBe(true);
    const r = (out as { result: { totalSize: number; records: Array<{ Id: string }> } }).result;
    expect(r.totalSize).toBe(1);
    expect(r.records[0]).toMatchObject({ Id: '001', Name: 'Acme' });
  });

  it('creates a record through the per-instance relative path', async () => {
    const s = setup();
    const begin = await s.runtime.beginAuth('salesforce', { scopes: [] });
    await s.runtime.completeAuth({ code: `code-${begin.requestId}`, state: begin.requestId });
    const out = await s.runtime.runAction('salesforce.create_record', { sobject: 'Account', fields: { Name: 'Acme' } });
    expect(out.ok).toBe(true);
    expect(s.calls).toContain(`${INSTANCE}/services/data/v59.0/sobjects/Account`);
  });
});
