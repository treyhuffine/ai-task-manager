import { createHash } from 'node:crypto';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { getHostedMcpProvider } from '@connectors/engine/providers';
import { describe, expect, it, vi } from 'vitest';
import { makeMcpOAuthProvider, type McpOAuthProviderDeps, type McpOAuthState } from './mcp-oauth';

// Public GET-only SDK discovery observed 2026-09-29 UTC. Every request in these
// tests is intercepted. Registration and token responses are synthetic. No live
// registration, Robinhood account, consent, tools or trades are exercised.
const endpoint = 'https://agent.robinhood.com/mcp/trading';
const resourceMetadataUrl = 'https://agent.robinhood.com/.well-known/oauth-protected-resource/mcp/trading';
const authorizationMetadataUrl = 'https://agent.robinhood.com/.well-known/oauth-authorization-server/mcp/trading';
const resourceMetadata = {
  authorization_servers: [endpoint],
  bearer_methods_supported: ['header'],
  resource: endpoint,
  scopes_supported: ['internal'],
};
const authorizationMetadata = {
  authorization_endpoint: 'https://robinhood.com/oauth',
  code_challenge_methods_supported: ['S256'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  issuer: endpoint,
  registration_endpoint: 'https://agent.robinhood.com/oauth/trading/register',
  response_types_supported: ['code'],
  scopes_supported: ['internal'],
  token_endpoint: 'https://api.robinhood.com/oauth2/token/',
  token_endpoint_auth_methods_supported: ['none'],
};

describe('Robinhood hosted OAuth profile', () => {
  it('uses the official hosted endpoint with a high mutation floor', () => {
    expect(getHostedMcpProvider('robinhood')).toMatchObject({ url: endpoint, defaultMutationRisk: 'high' });
  });

  it.each([
    { channel: 'web' as const, redirectUrl: 'https://app.example/api/connectors/mcp-oauth/fixture-server' },
    { channel: 'desktop' as const, redirectUrl: 'http://127.0.0.1:45123/mcp/callback' },
  ])('uses path-qualified discovery, public DCR and resource-bound tokens for $channel', async ({ channel, redirectUrl }) => {
    const definition = getHostedMcpProvider('robinhood');
    const catalogAuth = definition?.auth ?? { kind: 'oauth' as const };
    if (catalogAuth.kind !== 'oauth') throw new Error('Expected catalog OAuth profile');
    expect(catalogAuth.registration ?? 'dynamic').toBe('dynamic');
    expect(catalogAuth.tokenEndpointAuthMethod ?? 'none').toBe('none');
    expect(catalogAuth.grantTypes ?? ['authorization_code', 'refresh_token']).toEqual(['authorization_code', 'refresh_token']);

    let saved: McpOAuthState = {};
    let revision = 0;
    const deps: McpOAuthProviderDeps = {
      redirectUrl, clientName: 'Connector fixture', callbackChannel: channel,
      grantTypes: catalogAuth.grantTypes, tokenEndpointAuthMethod: catalogAuth.tokenEndpointAuthMethod,
      load: async () => structuredClone(saved),
      compareAndSave: async (expected, state) => {
        if (saved.revision !== expected) return null;
        saved = structuredClone({ ...state, revision: String(++revision) });
        return structuredClone(saved);
      },
    };
    const registrations: Record<string, unknown>[] = [];
    const tokens: URLSearchParams[] = [];
    const fetchFixture = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === resourceMetadataUrl && method === 'GET') return Response.json(resourceMetadata);
      if (url === authorizationMetadataUrl && method === 'GET') return Response.json(authorizationMetadata);
      if (url === authorizationMetadata.registration_endpoint && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        registrations.push(body);
        return Response.json({ ...body, client_id: 'fixture-robinhood-client' });
      }
      if (url === authorizationMetadata.token_endpoint && method === 'POST') {
        const body = new URLSearchParams(String(init?.body));
        tokens.push(body);
        expect(new Headers(init?.headers).has('Authorization')).toBe(false);
        expect(body.has('client_secret')).toBe(false);
        return Response.json({ access_token: `fixture-access-${tokens.length}`, token_type: 'Bearer',
          refresh_token: `fixture-refresh-${tokens.length}`, scope: 'internal' });
      }
      throw new Error(`Unexpected fixture request: ${method} ${url}`);
    });
    const redirect = vi.fn();
    const interactive = makeMcpOAuthProvider({ ...deps, interactive: true, onRedirect: redirect });
    expect(await auth(interactive, { serverUrl: endpoint, fetchFn: fetchFixture })).toBe('REDIRECT');
    expect(registrations).toEqual([{
      client_name: deps.clientName, redirect_uris: [redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: 'none', scope: 'internal',
    }]);
    expect(saved.discoveryState).toMatchObject({
      authorizationServerUrl: endpoint, authorizationServerMetadata: authorizationMetadata, resourceMetadata,
    });
    const consentUrl = redirect.mock.calls[0][0] as URL;
    expect(`${consentUrl.origin}${consentUrl.pathname}`).toBe(authorizationMetadata.authorization_endpoint);
    expect(consentUrl.searchParams.get('scope')).toBe('internal');
    expect(consentUrl.searchParams.get('resource')).toBe(endpoint);
    expect(consentUrl.searchParams.get('client_id')).toBe('fixture-robinhood-client');
    expect(consentUrl.searchParams.get('redirect_uri')).toBe(redirectUrl);
    expect(consentUrl.searchParams.get('state')).toBe(saved.authorizationState);
    expect(saved.callbackChannel).toBe(channel);
    const verifier = saved.codeVerifier!;
    expect(consentUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(consentUrl.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));

    // The callback route consumes state before it exchanges the authorization
    // code. A new provider then reuses discovery and the registered callback.
    saved = { ...saved, revision: String(++revision) };
    delete saved.authorizationState;
    delete saved.authorizationExpiresAt;
    const callback = makeMcpOAuthProvider({ ...deps, redirectUrl: 'https://changed-app.example/callback' });
    expect(await auth(callback, { serverUrl: endpoint, authorizationCode: 'fixture-code', fetchFn: fetchFixture })).toBe('AUTHORIZED');
    expect(Object.fromEntries(tokens[0])).toMatchObject({
      grant_type: 'authorization_code', code: 'fixture-code', code_verifier: verifier,
      client_id: 'fixture-robinhood-client', redirect_uri: redirectUrl, resource: endpoint,
    });
    const background = makeMcpOAuthProvider(deps);
    expect(await auth(background, { serverUrl: endpoint, fetchFn: fetchFixture })).toBe('AUTHORIZED');
    expect(Object.fromEntries(tokens[1])).toMatchObject({
      grant_type: 'refresh_token', refresh_token: 'fixture-refresh-1',
      client_id: 'fixture-robinhood-client', resource: endpoint,
    });
    expect(saved.tokens?.access_token).toBe('fixture-access-2');
    expect(saved.tokens?.refresh_token).toBe('fixture-refresh-2');
    expect(saved.authorizationState).toBeUndefined();
    expect(saved.codeVerifier).toBeUndefined();
    expect(registrations).toHaveLength(1);
    expect(fetchFixture.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === 'GET')).toHaveLength(2);
  });
});
