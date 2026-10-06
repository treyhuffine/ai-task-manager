import { createHash } from 'node:crypto';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { getHostedMcpProvider } from '@integrations/engine/providers';
import { describe, expect, it, vi } from 'vitest';
import { makeMcpOAuthProvider, type McpOAuthProviderDeps, type McpOAuthState } from './mcp-oauth';

// Public GET discovery and official GitLab DCR source, observed 2026-09-28.
// Every request is intercepted, including registration, code exchange and refresh.
const profiles = [
  {
    id: 'gitlab', url: 'https://gitlab.com/api/v4/mcp', resource: 'https://gitlab.com/api/v4/mcp',
    resourceMetadataUrl: 'https://gitlab.com/.well-known/oauth-protected-resource/api/v4/mcp',
    issuer: 'https://gitlab.com', metadataUrl: 'https://gitlab.com/.well-known/oauth-authorization-server',
    authorizeUrl: 'https://gitlab.com/oauth/authorize', tokenUrl: 'https://gitlab.com/oauth/token',
    registerUrl: 'https://gitlab.com/oauth/register', methods: ['client_secret_basic', 'client_secret_post'],
    grants: ['authorization_code'] as const, resourceScopes: ['mcp'],
    // AS metadata lists additional non-MCP scopes. Only the protected-resource
    // scope must be requested, never the wider general GitLab API scope.
    authorizationScopes: ['api', 'read_api', 'mcp', 'mcp_orbit'],
  },
  {
    id: 'stripe', url: 'https://mcp.stripe.com', resource: 'https://mcp.stripe.com',
    resourceMetadataUrl: 'https://mcp.stripe.com/.well-known/oauth-protected-resource',
    issuer: 'https://access.stripe.com/mcp', metadataUrl: 'https://access.stripe.com/.well-known/oauth-authorization-server/mcp',
    authorizeUrl: 'https://access.stripe.com/mcp/oauth2/authorize', tokenUrl: 'https://access.stripe.com/mcp/oauth2/token',
    registerUrl: 'https://access.stripe.com/mcp/oauth2/register', methods: ['none'],
    grants: ['authorization_code', 'refresh_token'] as const, resourceScopes: undefined,
    authorizationScopes: ['mcp'],
  },
];

describe('GitLab and Stripe public MCP OAuth profiles', () => {
  it.each(profiles)('uses $id discovery, public DCR, PKCE and secretless token requests', async (profile) => {
    const definition = getHostedMcpProvider(profile.id);
    expect(definition).toMatchObject({ url: profile.url, defaultMutationRisk: 'high' });
    const catalogAuth = definition?.auth ?? { kind: 'oauth' as const };
    if (catalogAuth.kind !== 'oauth') throw new Error('Expected catalog OAuth profile');
    expect(catalogAuth.grantTypes ?? ['authorization_code', 'refresh_token']).toEqual([...profile.grants]);
    expect(catalogAuth.tokenEndpointAuthMethod ?? 'none').toBe('none');
    let saved: McpOAuthState = {};
    let revision = 0;
    const deps: McpOAuthProviderDeps = {
      redirectUrl: 'https://app.example/mcp/callback', clientName: 'Integration fixture',
      grantTypes: catalogAuth.grantTypes, tokenEndpointAuthMethod: catalogAuth.tokenEndpointAuthMethod,
      load: async () => structuredClone(saved),
      compareAndSave: async (expected, state) => {
        if (saved.revision !== expected) return null;
        saved = structuredClone({ ...state, revision: String(++revision) });
        return structuredClone(saved);
      },
    };
    const clientId = `fixture-${profile.id}-client`;
    const registrations: Record<string, unknown>[] = [];
    const tokenBodies: URLSearchParams[] = [];
    const tokenHeaders: Headers[] = [];
    const fetchFixture = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === profile.registerUrl && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        registrations.push(body);
        // GitLab's controller ignores requested auth/grant metadata and returns
        // this public-client shape, despite the AS advertising only secrets.
        return Response.json(profile.id === 'gitlab' ? {
          client_id: clientId, client_id_issued_at: 1, redirect_uris: [deps.redirectUrl],
          token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], require_pkce: true,
          client_name: '[Unverified Dynamic Application] Integration fixture', scope: 'mcp', dynamic: true,
        } : { ...body, client_id: clientId });
      }
      if (url === profile.tokenUrl && method === 'POST') {
        tokenBodies.push(new URLSearchParams(String(init?.body)));
        tokenHeaders.push(new Headers(init?.headers));
        // Synthetic tokens test SDK behavior if refresh is issued. This does
        // not assert that a live GitLab DCR session necessarily gets one.
        return Response.json({ access_token: `fixture-access-${tokenBodies.length}`,
          refresh_token: `fixture-refresh-${tokenBodies.length}`, token_type: 'Bearer', scope: 'mcp' });
      }
      if (method === 'GET' && url === profile.resourceMetadataUrl) return Response.json({
        resource: profile.resource, authorization_servers: [profile.issuer],
        ...(profile.resourceScopes ? { scopes_supported: profile.resourceScopes } : {}),
      });
      if (method === 'GET' && url === profile.metadataUrl) return Response.json({
        issuer: profile.issuer, authorization_endpoint: profile.authorizeUrl,
        token_endpoint: profile.tokenUrl, registration_endpoint: profile.registerUrl,
        response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: profile.methods, code_challenge_methods_supported: ['S256'],
        scopes_supported: profile.authorizationScopes,
      });
      throw new Error(`Unexpected fixture request: ${method} ${url}`);
    });

    const redirect = vi.fn();
    const interactive = makeMcpOAuthProvider({ ...deps, interactive: true, onRedirect: redirect });
    expect(await auth(interactive, { serverUrl: profile.url, fetchFn: fetchFixture })).toBe('REDIRECT');
    expect(registrations).toEqual([{
      client_name: deps.clientName, redirect_uris: [deps.redirectUrl], grant_types: [...profile.grants],
      response_types: ['code'], token_endpoint_auth_method: 'none',
      ...(profile.resourceScopes ? { scope: profile.resourceScopes.join(' ') } : {}),
    }]);
    expect(saved.clientInformation).not.toHaveProperty('client_secret');
    const consentUrl = redirect.mock.calls[0][0] as URL;
    expect(`${consentUrl.origin}${consentUrl.pathname}`).toBe(profile.authorizeUrl);
    expect(consentUrl.searchParams.get('scope')).toBe(profile.resourceScopes?.join(' ') ?? null);
    expect(consentUrl.searchParams.get('resource')).toBe(new URL(profile.resource).href);
    expect(consentUrl.searchParams.get('state')).toBe(saved.authorizationState);
    expect(consentUrl.searchParams.get('code_challenge_method')).toBe('S256');
    const verifier = saved.codeVerifier!;
    expect(consentUrl.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));

    // Mirror the host's successful one-time state consumption before callback.
    saved = { ...saved, revision: String(++revision) };
    delete saved.authorizationState;
    delete saved.authorizationExpiresAt;
    const callback = makeMcpOAuthProvider(deps);
    expect(await auth(callback, { serverUrl: profile.url, authorizationCode: 'fixture-code', fetchFn: fetchFixture })).toBe('AUTHORIZED');
    expect(Object.fromEntries(tokenBodies[0])).toMatchObject({
      grant_type: 'authorization_code', code: 'fixture-code', code_verifier: verifier,
      client_id: clientId, redirect_uri: deps.redirectUrl,
    });

    const background = makeMcpOAuthProvider(deps);
    expect(await auth(background, { serverUrl: profile.url, fetchFn: fetchFixture })).toBe('AUTHORIZED');
    expect(Object.fromEntries(tokenBodies[1])).toMatchObject({
      grant_type: 'refresh_token', refresh_token: 'fixture-refresh-1', client_id: clientId,
    });
    expect(tokenBodies).toHaveLength(2);
    for (const body of tokenBodies) expect(body.has('client_secret')).toBe(false);
    for (const headers of tokenHeaders) expect(headers.has('Authorization')).toBe(false);
    expect(registrations).toHaveLength(1);
    expect(saved.tokens).toMatchObject({ access_token: 'fixture-access-2', refresh_token: 'fixture-refresh-2' });
  });
});
