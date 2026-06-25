/**
 * Jira connector (OAuth2 3LO + per-site cloudId). Exercises connect → identify (accessible
 * resources → cloudId as accountId) → a JQL search through the absolute per-site URL.
 */
import { describe, it, expect } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { staticAuthConfigs } from '../auth-configs';
import { registerJira } from '../providers/jira';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';

function setup() {
  const http = fakeHttp(async (call) => {
    if (call.url.startsWith('https://auth.atlassian.com/oauth/token')) {
      return { json: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'offline_access read:me read:jira-work write:jira-work' } };
    }
    if (call.url.startsWith('https://api.atlassian.com/oauth/token/accessible-resources')) {
      return { json: [{ id: 'CLOUD1', name: 'My Site', url: 'https://site.atlassian.net' }] };
    }
    if (call.url.includes('/ex/jira/CLOUD1/rest/api/3/search')) {
      return { json: { total: 1, issues: [{ id: '1', key: 'ABC-1', fields: { summary: 'Bug', status: { name: 'To Do' } } }] } };
    }
    return { json: {} };
  });
  const registry = createRegistry();
  registerJira(registry, { fetch: http.fetch });
  const store = inMemoryStore();
  const runtime = createConnectorRuntime({
    registry,
    store,
    authRequests: store,
    secretBox: plaintextSecretBox(),
    authConfigs: staticAuthConfigs([
      { id: 'jira', providerId: 'jira', scheme: 'oauth2', scope: 'global', oauth: { clientId: 'c', redirectUri: 'http://127.0.0.1/cb' }, clientSecret: 's', status: 'active' },
    ]),
    redactor: createRedactor(),
    approval: { async check() { return 'allow'; } },
    fetch: http.fetch,
  });
  return { runtime, http };
}

describe('jira connector', () => {
  it('connects, identifies the cloudId as the account, and searches issues', async () => {
    const s = setup();
    const begin = await s.runtime.beginAuth('jira', { scopes: ['read:jira-work', 'write:jira-work'] });
    const conn = await s.runtime.completeAuth({ code: `code-${begin.requestId}`, state: begin.requestId });
    expect(conn.accountId).toBe('CLOUD1');
    expect(conn.label).toBe('My Site');
    expect(conn.config).toEqual({ cloudId: 'CLOUD1' }); // captured at connect — not an action input

    const out = await s.runtime.runAction('jira.search_issues', { jql: 'project = ABC' });
    expect(out.ok).toBe(true);
    expect((out as { result: { issues: Array<{ key: string; status: string }> } }).result.issues[0]).toMatchObject({
      key: 'ABC-1',
      summary: 'Bug',
      status: 'To Do',
    });
  });

  it('builds the authorization URL with the Atlassian audience param', async () => {
    const s = setup();
    const begin = await s.runtime.beginAuth('jira', { scopes: ['read:jira-work'] });
    expect(begin.authorizationUrl).toContain('auth.atlassian.com/authorize');
    expect(begin.authorizationUrl).toContain('audience=api.atlassian.com');
  });
});
