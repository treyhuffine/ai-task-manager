/**
 * Per-connection context (F1): a provider captures per-connection metadata at connect — from
 * identify(), from the token response (resolveBaseUrl), or from the OAuth callback params — and
 * actions read it via `httpAction`'s `request(input, { config })` / the connection baseUrl, so a
 * site id (cloudId / realmId / instance_url) NEVER appears on the action's input schema.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { defineProvider, defineToolkit, httpAction } from '../core/authoring';
import { oauth2 } from '../auth/oauth2';
import { bearer } from '../auth/direct';
import { staticAuthConfigs } from '../auth-configs';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';
import type { AuthedHttp, IdentifyContext } from '../core/types';

const RU = 'http://127.0.0.1/cb';

describe('per-connection config via identify() (cloudId / Jira-style)', () => {
  it('captures config at connect; httpAction.request reads it (no site id on the input)', async () => {
    const calls: string[] = [];
    const http = fakeHttp(async (c) => {
      calls.push(c.url);
      if (c.url.endsWith('/me')) return { json: { id: 'u1', cloudId: 'CLOUD-123' } };
      return { json: { ok: true } };
    });
    const provider = defineProvider({
      id: 'svc',
      displayName: 'Svc',
      baseUrl: 'https://api.svc.test',
      auth: bearer(),
      identify: async (h: AuthedHttp) => {
        const me = await h.get<{ id: string; cloudId: string }>('/me');
        return { accountId: me.id, config: { cloudId: me.cloudId } };
      },
    });
    const toolkit = defineToolkit({
      id: 'svc',
      providerId: 'svc',
      displayName: 'Svc',
      actions: [
        httpAction({
          id: 'svc.get_thing',
          description: 'reads cloudId from connection config, not input',
          input: z.object({ name: z.string() }),
          request: (i, { config }) => ({ method: 'GET', path: `/sites/${config.cloudId}/things/${i.name}` }),
        }),
      ],
    });
    const registry = createRegistry();
    registry.addBundle({ provider, toolkits: [toolkit] });
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

    const conn = await runtime.connectDirect('svc', { credential: { type: 'bearer', token: 't' } });
    expect(conn.config).toEqual({ cloudId: 'CLOUD-123' }); // captured at connect

    const out = await runtime.runAction('svc.get_thing', { name: 'x' });
    expect(out.ok).toBe(true);
    // The action built the URL from the stored cloudId — the agent passed only `name`.
    expect(calls).toContain('https://api.svc.test/sites/CLOUD-123/things/x');
  });
});

describe('per-connection baseUrl via resolveBaseUrl (instance_url / Salesforce-style)', () => {
  it('derives the API base from the token response and routes every call to it', async () => {
    const calls: string[] = [];
    const http = fakeHttp(async (c) => {
      calls.push(c.url);
      if (c.url.includes('/token')) return { json: { access_token: 'a', instance_url: 'https://inst.example.com', scope: '' } };
      if (c.url.includes('/userinfo')) return { json: { sub: 'sf-1' } };
      return { json: { records: [] } };
    });
    const provider = defineProvider({
      id: 'sf',
      displayName: 'SF',
      auth: oauth2({ authorizationUrl: 'https://login.sf/auth', tokenUrl: 'https://login.sf/token', fetch: http.fetch }),
      resolveBaseUrl: (ctx: IdentifyContext) => (ctx.tokenResponse as { instance_url?: string })?.instance_url,
      identify: async (h: AuthedHttp) => {
        const me = await h.get<{ sub: string }>('/services/oauth2/userinfo');
        return { accountId: me.sub };
      },
    });
    const toolkit = defineToolkit({
      id: 'sf',
      providerId: 'sf',
      displayName: 'SF',
      actions: [
        httpAction({ id: 'sf.query', description: 'relative path → resolves against instance_url', input: z.object({}), request: () => ({ method: 'GET', path: '/services/data/query' }) }),
      ],
    });
    const registry = createRegistry();
    registry.addBundle({ provider, toolkits: [toolkit] });
    const store = inMemoryStore();
    const runtime = createConnectorRuntime({
      registry,
      store,
      authRequests: store,
      secretBox: plaintextSecretBox(),
      authConfigs: staticAuthConfigs([{ id: 'sf', providerId: 'sf', scheme: 'oauth2', scope: 'global', isDefault: true, oauth: { clientId: 'c', redirectUri: RU }, clientSecret: 's', status: 'active' }]),
      redactor: createRedactor(),
      approval: { async check() { return 'allow'; } },
      fetch: http.fetch,
    });

    const begin = await runtime.beginAuth('sf', { scopes: [] });
    const conn = await runtime.completeAuth({ code: `code-${begin.requestId}`, state: begin.requestId });
    expect(conn.baseUrl).toBe('https://inst.example.com'); // captured from the token response

    // identify already hit the instance host:
    expect(calls).toContain('https://inst.example.com/services/oauth2/userinfo');
    const out = await runtime.runAction('sf.query', {});
    expect(out.ok).toBe(true);
    expect(calls).toContain('https://inst.example.com/services/data/query'); // action routed to it
  });
});

describe('per-connection config via callback params (realmId / QuickBooks-style)', () => {
  it('captures a callback query param into connection.config', async () => {
    const http = fakeHttp(async (c) => {
      if (c.url.includes('/token')) return { json: { access_token: 'a', scope: '' } };
      return { json: {} };
    });
    const provider = defineProvider({
      id: 'qb',
      displayName: 'QB',
      auth: oauth2({ authorizationUrl: 'https://qb/auth', tokenUrl: 'https://qb/token', fetch: http.fetch }),
      identify: async (_h: AuthedHttp, ctx: IdentifyContext) => ({
        accountId: ctx.params?.realmId ?? 'qb:default',
        ...(ctx.params?.realmId ? { config: { realmId: ctx.params.realmId } } : {}),
      }),
    });
    const registry = createRegistry();
    registry.addBundle({ provider, toolkits: [defineToolkit({ id: 'qb', providerId: 'qb', displayName: 'QB', actions: [] })] });
    const store = inMemoryStore();
    const runtime = createConnectorRuntime({
      registry,
      store,
      authRequests: store,
      secretBox: plaintextSecretBox(),
      authConfigs: staticAuthConfigs([{ id: 'qb', providerId: 'qb', scheme: 'oauth2', scope: 'global', isDefault: true, oauth: { clientId: 'c', redirectUri: RU }, clientSecret: 's', status: 'active' }]),
      redactor: createRedactor(),
      approval: { async check() { return 'allow'; } },
      fetch: http.fetch,
    });

    const begin = await runtime.beginAuth('qb', { scopes: [] });
    const conn = await runtime.completeAuth({ code: `code-${begin.requestId}`, state: begin.requestId, params: { realmId: 'REALM-9' } });
    expect(conn.config).toEqual({ realmId: 'REALM-9' });
    expect(conn.accountId).toBe('REALM-9');
  });
});

describe('add_scopes refreshes per-connection context (review finding #5)', () => {
  it('updates connection.config on incremental consent, not just scopes', async () => {
    let cloudId = 'A';
    const http = fakeHttp(async (c) => {
      if (c.url.includes('/token')) return { json: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: '' } };
      return { json: {} };
    });
    const provider = defineProvider({
      id: 'inst',
      displayName: 'Inst',
      baseUrl: 'https://api.inst.test',
      auth: oauth2({ authorizationUrl: 'https://inst/auth', tokenUrl: 'https://inst/token', fetch: http.fetch }),
      identify: async () => ({ accountId: 'acc', config: { cloudId } }),
    });
    const registry = createRegistry();
    registry.addBundle({ provider, toolkits: [defineToolkit({ id: 'inst', providerId: 'inst', displayName: 'Inst', actions: [] })] });
    const store = inMemoryStore();
    const runtime = createConnectorRuntime({
      registry, store, authRequests: store, secretBox: plaintextSecretBox(),
      authConfigs: staticAuthConfigs([{ id: 'inst', providerId: 'inst', scheme: 'oauth2', scope: 'global', isDefault: true, oauth: { clientId: 'c', redirectUri: RU }, clientSecret: 's', status: 'active' }]),
      redactor: createRedactor(), approval: { async check() { return 'allow'; } }, fetch: http.fetch,
    });

    const begin1 = await runtime.beginAuth('inst', { scopes: ['s1'] });
    const conn = await runtime.completeAuth({ code: `code-${begin1.requestId}`, state: begin1.requestId });
    expect(conn.config).toEqual({ cloudId: 'A' });

    cloudId = 'B'; // the instance/site context moved between connect and re-consent
    const begin2 = await runtime.beginAuth('inst', { scopes: ['s2'], existingConnectionId: conn.id });
    const updated = await runtime.completeAuth({ code: `code-${begin2.requestId}`, state: begin2.requestId });
    expect(updated.id).toBe(conn.id);
    expect(updated.config).toEqual({ cloudId: 'B' }); // refreshed on add_scopes — the fix
    expect(updated.scopes).toEqual(expect.arrayContaining(['s1', 's2']));
  });
});
