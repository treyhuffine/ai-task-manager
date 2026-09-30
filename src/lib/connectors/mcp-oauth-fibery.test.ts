import { createHash } from 'node:crypto';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { getHostedMcpProvider } from '@connectors/engine/providers';
import { describe, expect, it, vi } from 'vitest';
import capture from '../../../docs/connector-audit/seventh-wave-discovery.json';
import { makeMcpOAuthProvider, type McpOAuthProviderDeps, type McpOAuthState } from './mcp-oauth';

// Every request is intercepted. Public discovery is real, registration and
// token responses are synthetic. No workspace or remote client is created.
describe('Fibery hosted OAuth', () => {
  it.each([
    { channel: 'web' as const, redirectUrl: 'https://app.example/api/connectors/mcp-oauth/fibery-account' },
    { channel: 'desktop' as const, redirectUrl: 'http://127.0.0.1:45123/mcp/callback' },
  ])('keeps discovered offline scope, PKCE and registered callback for $channel', async ({ channel, redirectUrl }) => {
    const definition = getHostedMcpProvider('fibery')!;
    expect(definition).toMatchObject({ url: 'https://mcp.fibery.io/mcp', defaultMutationRisk: 'high' });
    const catalogAuth = definition.auth ?? { kind: 'oauth' as const };
    if (catalogAuth.kind !== 'oauth') throw new Error('Expected OAuth profile');
    const observed = capture.records.find(record => record.id === 'fibery')!;
    const { resourceMetadata, authorizationServerMetadata: metadata } = observed.discovery;
    const requestedScopes = resourceMetadata.scopes_supported!.join(' ');
    expect(requestedScopes).toBe('openid offline');
    let saved: McpOAuthState = {};
    let revision = 0;
    const deps: McpOAuthProviderDeps = {
      redirectUrl, callbackChannel: channel, clientName: 'Fibery fixture',
      grantTypes: catalogAuth.grantTypes, tokenEndpointAuthMethod: catalogAuth.tokenEndpointAuthMethod,
      load: async () => structuredClone(saved),
      compareAndSave: async (expected, next) => {
        if (saved.revision !== expected) return null;
        saved = structuredClone({ ...next, revision: String(++revision) });
        return structuredClone(saved);
      },
    };
    const registrations: Record<string, unknown>[] = [];
    const exchanges: URLSearchParams[] = [];
    const fetchFixture = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === 'https://mcp.fibery.io/.well-known/oauth-protected-resource/mcp' && method === 'GET') return Response.json(resourceMetadata);
      if (url === 'https://mcp.fibery.io/.well-known/oauth-authorization-server' && method === 'GET') return Response.json(metadata);
      if (url === metadata.registration_endpoint && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        registrations.push(body);
        return Response.json({ ...body, client_id: 'fixture-fibery-client' });
      }
      if (url === metadata.token_endpoint && method === 'POST') {
        const body = new URLSearchParams(String(init?.body));
        expect(body.has('client_secret')).toBe(false);
        expect(new Headers(init?.headers).has('Authorization')).toBe(false);
        exchanges.push(body);
        return Response.json({ access_token: `fixture-access-${exchanges.length}`, token_type: 'Bearer',
          refresh_token: `fixture-refresh-${exchanges.length}`, scope: requestedScopes });
      }
      throw new Error(`Unexpected fixture request: ${method} ${url}`);
    });
    const redirect = vi.fn();
    expect(await auth(makeMcpOAuthProvider({ ...deps, interactive: true, onRedirect: redirect }), {
      serverUrl: definition.url!, fetchFn: fetchFixture,
    })).toBe('REDIRECT');
    expect(registrations).toEqual([{
      client_name: deps.clientName, redirect_uris: [redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: 'none', scope: requestedScopes,
    }]);
    const consent = redirect.mock.calls[0][0] as URL;
    expect(`${consent.origin}${consent.pathname}`).toBe(metadata.authorization_endpoint);
    expect(consent.searchParams.get('scope')).toBe(requestedScopes);
    expect(consent.searchParams.get('resource')).toBe(resourceMetadata.resource);
    expect(consent.searchParams.get('state')).toBe(saved.authorizationState);
    expect(saved.discoveryState?.authorizationServerUrl).toBe('https://mcp.fibery.io/');
    const verifier = saved.codeVerifier!;
    expect(consent.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(consent.searchParams.get('code_challenge_method')).toBe('S256');
    delete saved.authorizationState;
    delete saved.authorizationExpiresAt;
    saved.revision = String(++revision);
    expect(await auth(makeMcpOAuthProvider({ ...deps, redirectUrl: 'https://changed.example/callback' }), {
      serverUrl: definition.url!, authorizationCode: 'fixture-code', fetchFn: fetchFixture,
    })).toBe('AUTHORIZED');
    expect(Object.fromEntries(exchanges[0])).toMatchObject({ grant_type: 'authorization_code', code: 'fixture-code',
      code_verifier: verifier, redirect_uri: redirectUrl, client_id: 'fixture-fibery-client', resource: resourceMetadata.resource });
    expect(await auth(makeMcpOAuthProvider(deps), { serverUrl: definition.url!, fetchFn: fetchFixture })).toBe('AUTHORIZED');
    expect(Object.fromEntries(exchanges[1])).toMatchObject({ grant_type: 'refresh_token',
      refresh_token: 'fixture-refresh-1', client_id: 'fixture-fibery-client', resource: resourceMetadata.resource });
    expect(registrations).toHaveLength(1);
    expect(saved.tokens?.access_token).toBe('fixture-access-2');
    expect(saved.codeVerifier).toBeUndefined();
  });
});
