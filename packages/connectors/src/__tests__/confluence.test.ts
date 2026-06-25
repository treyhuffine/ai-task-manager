/**
 * Confluence connector (OAuth2 3LO + per-site cloudId). Exercises connect → identify (accessible
 * resources → cloudId as accountId) → a CQL search through the absolute per-site URL.
 */
import { describe, it, expect } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { staticAuthConfigs } from '../auth-configs';
import { registerConfluence } from '../providers/confluence';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';

function setup() {
  const http = fakeHttp(async (call) => {
    if (call.url.startsWith('https://auth.atlassian.com/oauth/token')) {
      return { json: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'offline_access read:me read:confluence-content.all write:confluence-content' } };
    }
    if (call.url.startsWith('https://api.atlassian.com/oauth/token/accessible-resources')) {
      return { json: [{ id: 'CLOUD1', name: 'My Site', url: 'https://site.atlassian.net' }] };
    }
    if (call.url.includes('/ex/confluence/CLOUD1/wiki/rest/api/search')) {
      return { json: { results: [{ content: { id: '100', title: 'Roadmap', type: 'page' } }] } };
    }
    return { json: {} };
  });
  const registry = createRegistry();
  registerConfluence(registry, { fetch: http.fetch });
  const store = inMemoryStore();
  const runtime = createConnectorRuntime({
    registry,
    store,
    authRequests: store,
    secretBox: plaintextSecretBox(),
    authConfigs: staticAuthConfigs([
      { id: 'confluence', providerId: 'confluence', scheme: 'oauth2', scope: 'global', oauth: { clientId: 'c', redirectUri: 'http://127.0.0.1/cb' }, clientSecret: 's', status: 'active' },
    ]),
    redactor: createRedactor(),
    approval: { async check() { return 'allow'; } },
    fetch: http.fetch,
  });
  return { runtime, http };
}

describe('confluence connector', () => {
  it('connects, identifies the cloudId as the account, and searches pages', async () => {
    const s = setup();
    const begin = await s.runtime.beginAuth('confluence', { scopes: ['read:confluence-content.all'] });
    const conn = await s.runtime.completeAuth({ code: `code-${begin.requestId}`, state: begin.requestId });
    expect(conn.accountId).toBe('CLOUD1');
    expect(conn.label).toBe('My Site');
    expect(conn.config).toEqual({ cloudId: 'CLOUD1' }); // captured at connect — not an action input

    const out = await s.runtime.runAction('confluence.search_pages', { cql: 'text ~ "roadmap"' });
    expect(out.ok).toBe(true);
    expect((out as { result: { results: Array<{ id: string; title: string }> } }).result.results[0]).toMatchObject({
      id: '100',
      title: 'Roadmap',
      type: 'page',
    });
  });

  it('builds the authorization URL with the Atlassian audience param', async () => {
    const s = setup();
    const begin = await s.runtime.beginAuth('confluence', { scopes: ['read:confluence-content.all'] });
    expect(begin.authorizationUrl).toContain('auth.atlassian.com/authorize');
    expect(begin.authorizationUrl).toContain('audience=api.atlassian.com');
  });
});
