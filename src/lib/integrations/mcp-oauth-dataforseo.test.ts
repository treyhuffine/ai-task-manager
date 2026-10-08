import { createHash } from 'node:crypto';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { getHostedMcpProvider } from '@integrations/engine/providers';
import { describe, expect, it, vi } from 'vitest';
import capture from '../../../docs/integration-audit/eighth-wave-discovery.json';
import { makeMcpOAuthProvider, type McpOAuthProviderDeps, type McpOAuthState } from './mcp-oauth';

const observed = capture.records.find(record => record.id === 'dataforseo')!;

// Every request is intercepted. Public discovery is real, registration and
// token responses are synthetic. No workspace or remote client is created.
describe('DataForSEO hosted OAuth', () => {
  it('pins the catalog scope to the one the live challenge requires', () => {
    const definition = getHostedMcpProvider('dataforseo')!;
    expect(definition).toMatchObject({ url: observed.endpoint, auth: { kind: 'oauth', scopes: ['api'] } });
    expect(definition.defaultMutationRisk).toBeUndefined();
    expect(observed.initialize_status).toBe(401);
    expect(/scope="([^"]+)"/.exec(observed.initialize_www_authenticate!)?.[1]).toBe('api');
    // Live resource metadata names no scopes, so only the catalog keeps `api`
    // when the SDK authorizes without a challenge.
    expect(observed.discovery.resourceMetadata).not.toHaveProperty('scopes_supported');
  });

  it.each([
    { channel: 'web' as const, redirectUrl: 'https://app.example/api/integrations/mcp-oauth/dataforseo-account' },
    { channel: 'desktop' as const, redirectUrl: 'http://127.0.0.1:45123/mcp/callback' },
  ])('registers a public client for the api scope, with PKCE and refresh, for $channel', async ({ channel, redirectUrl }) => {
    const definition = getHostedMcpProvider('dataforseo')!;
    const catalogAuth = definition.auth!;
    if (catalogAuth.kind !== 'oauth') throw new Error('Expected OAuth profile');
    const { resourceMetadata, authorizationServerMetadata: metadata } = observed.discovery;
    let saved: McpOAuthState = {};
    let revision = 0;
    const deps: McpOAuthProviderDeps = {
      redirectUrl, callbackChannel: channel, clientName: 'DataForSEO fixture',
      grantTypes: catalogAuth.grantTypes, tokenEndpointAuthMethod: catalogAuth.tokenEndpointAuthMethod, scopes: catalogAuth.scopes,
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
      // The service publishes only root resource metadata, as the capture recorded.
      if (url === 'https://mcp.dataforseo.com/.well-known/oauth-protected-resource/v3/mcp' && method === 'GET') return new Response('Not found', { status: 404 });
      if (url === 'https://mcp.dataforseo.com/.well-known/oauth-protected-resource' && method === 'GET') return Response.json(resourceMetadata);
      if (url === 'https://data.dataforseo.com/.well-known/oauth-authorization-server' && method === 'GET') return Response.json(metadata);
      if (url === metadata.registration_endpoint && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        registrations.push(body);
        return Response.json({ ...body, client_id: 'fixture-dataforseo-client' });
      }
      if (url === metadata.token_endpoint && method === 'POST') {
        const body = new URLSearchParams(String(init?.body));
        expect(body.has('client_secret')).toBe(false);
        expect(new Headers(init?.headers).has('Authorization')).toBe(false);
        exchanges.push(body);
        return Response.json({ access_token: `fixture-access-${exchanges.length}`, token_type: 'Bearer',
          refresh_token: `fixture-refresh-${exchanges.length}`, scope: 'api' });
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
      token_endpoint_auth_method: 'none', scope: 'api',
    }]);
    const consent = redirect.mock.calls[0][0] as URL;
    expect(`${consent.origin}${consent.pathname}`).toBe(metadata.authorization_endpoint);
    expect(consent.searchParams.get('scope')).toBe('api');
    // The SDK normalizes the bare-origin resource, as for any client on this SDK.
    expect(consent.searchParams.get('resource')).toBe('https://mcp.dataforseo.com/');
    expect(consent.searchParams.get('state')).toBe(saved.authorizationState);
    expect(saved.discoveryState?.authorizationServerUrl).toBe('https://data.dataforseo.com');
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
      code_verifier: verifier, redirect_uri: redirectUrl, client_id: 'fixture-dataforseo-client', resource: 'https://mcp.dataforseo.com/' });
    expect(await auth(makeMcpOAuthProvider(deps), { serverUrl: definition.url!, fetchFn: fetchFixture })).toBe('AUTHORIZED');
    expect(Object.fromEntries(exchanges[1])).toMatchObject({ grant_type: 'refresh_token',
      refresh_token: 'fixture-refresh-1', client_id: 'fixture-dataforseo-client', resource: 'https://mcp.dataforseo.com/' });
    expect(registrations).toHaveLength(1);
    expect(saved.tokens?.access_token).toBe('fixture-access-2');
    expect(saved.codeVerifier).toBeUndefined();
  });
});
