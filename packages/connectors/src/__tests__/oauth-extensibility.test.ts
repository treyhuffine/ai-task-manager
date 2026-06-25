/**
 * OAuth provider-specific escape hatches: `scopeSeparator` (Slack wants comma-delimited scopes on
 * the authorize URL) and `mapTokenResponse` (remap a non-standard token-endpoint shape — nested or
 * renamed access_token / scope). Both keep per-provider OAuth quirks in config, not a subclass.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { defineProvider, defineToolkit, httpAction } from '../core/authoring';
import { oauth2 } from '../auth/oauth2';
import { staticAuthConfigs } from '../auth-configs';
import { registerSlack } from '../providers/slack';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';

const RU = 'http://127.0.0.1/cb';

describe('oauth2 scopeSeparator', () => {
  it('Slack builds the authorize URL with COMMA-separated scopes', async () => {
    const http = fakeHttp(async () => ({ json: {} }));
    const registry = createRegistry();
    registerSlack(registry, { fetch: http.fetch });
    const store = inMemoryStore();
    const runtime = createConnectorRuntime({
      registry,
      store,
      authRequests: store,
      secretBox: plaintextSecretBox(),
      authConfigs: staticAuthConfigs([
        { id: 'slack', providerId: 'slack', scheme: 'oauth2', scope: 'global', oauth: { clientId: 'c', redirectUri: RU }, clientSecret: 's', status: 'active' },
      ]),
      redactor: createRedactor(),
      fetch: http.fetch,
    });
    const begin = await runtime.beginAuth('slack', { scopes: ['chat:write', 'channels:read'] });
    const scope = new URL(begin.authorizationUrl).searchParams.get('scope');
    expect(scope).toBe('chat:write,channels:read'); // comma, not space
  });

  it('defaults to space-separated scopes when no separator is set', async () => {
    const http = fakeHttp(async () => ({ json: {} }));
    const provider = defineProvider({
      id: 'sp',
      displayName: 'Sp',
      baseUrl: 'https://api.sp.test',
      auth: oauth2({ authorizationUrl: 'https://sp/auth', tokenUrl: 'https://sp/token', fetch: http.fetch }),
    });
    const registry = createRegistry();
    registry.addBundle({ provider, toolkits: [defineToolkit({ id: 'sp', providerId: 'sp', displayName: 'Sp', actions: [] })] });
    const store = inMemoryStore();
    const runtime = createConnectorRuntime({
      registry, store, authRequests: store, secretBox: plaintextSecretBox(),
      authConfigs: staticAuthConfigs([{ id: 'sp', providerId: 'sp', scheme: 'oauth2', scope: 'global', isDefault: true, oauth: { clientId: 'c', redirectUri: RU }, clientSecret: 's', status: 'active' }]),
      redactor: createRedactor(), fetch: http.fetch,
    });
    const begin = await runtime.beginAuth('sp', { scopes: ['a', 'b'] });
    expect(new URL(begin.authorizationUrl).searchParams.get('scope')).toBe('a b');
  });
});

describe('oauth2 mapTokenResponse', () => {
  it('remaps a nested/renamed token response; the mapped token is what calls use, mapped scope is what is granted', async () => {
    const calls: Array<{ url: string; auth?: string }> = [];
    const http = fakeHttp(async (c) => {
      calls.push({ url: c.url, auth: c.headers.authorization });
      if (c.url.includes('/token')) {
        // Non-standard shape: real token nested, scope under a different key.
        return { json: { ok: true, authed_user: { access_token: 'NESTED-AT', scope: 'read:thing write:thing' } } };
      }
      if (c.url.endsWith('/me')) return { json: { id: 'u1' } };
      return { json: { done: true } };
    });
    const provider = defineProvider({
      id: 'nest',
      displayName: 'Nest',
      baseUrl: 'https://api.nest.test',
      auth: oauth2({
        authorizationUrl: 'https://nest/auth',
        tokenUrl: 'https://nest/token',
        fetch: http.fetch,
        mapTokenResponse: (raw) => {
          const r = raw as { authed_user?: { access_token?: string; scope?: string } };
          return {
            ...(r.authed_user?.access_token ? { accessToken: r.authed_user.access_token } : {}),
            ...(r.authed_user?.scope ? { scope: r.authed_user.scope } : {}),
          };
        },
      }),
      identify: async (h) => {
        const me = await h.get<{ id: string }>('/me');
        return { accountId: me.id };
      },
    });
    const toolkit = defineToolkit({
      id: 'nest',
      providerId: 'nest',
      displayName: 'Nest',
      actions: [
        httpAction({ id: 'nest.read', description: 'read', scopes: ['read:thing'], input: z.object({}), request: () => ({ method: 'GET', path: '/thing' }) }),
      ],
    });
    const registry = createRegistry();
    registry.addBundle({ provider, toolkits: [toolkit] });
    const store = inMemoryStore();
    const runtime = createConnectorRuntime({
      registry, store, authRequests: store, secretBox: plaintextSecretBox(),
      authConfigs: staticAuthConfigs([{ id: 'nest', providerId: 'nest', scheme: 'oauth2', scope: 'global', isDefault: true, oauth: { clientId: 'c', redirectUri: RU }, clientSecret: 's', status: 'active' }]),
      redactor: createRedactor(), approval: { async check() { return 'allow'; } }, fetch: http.fetch,
    });

    const begin = await runtime.beginAuth('nest', { scopes: ['read:thing'] });
    const conn = await runtime.completeAuth({ code: `code-${begin.requestId}`, state: begin.requestId });
    // Granted scopes came from the MAPPED scope, not the absent top-level `scope`.
    expect(conn.scopes).toEqual(['read:thing', 'write:thing']);

    const out = await runtime.runAction('nest.read', {});
    expect(out.ok).toBe(true);
    // The action authed with the NESTED token the hook extracted.
    const thingCall = calls.find((c) => c.url.endsWith('/thing'));
    expect(thingCall?.auth).toBe('Bearer NESTED-AT');
  });
});
