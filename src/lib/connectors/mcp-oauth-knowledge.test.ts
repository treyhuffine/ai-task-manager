import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { getHostedMcpProvider } from '@connectors/engine/providers';
import { describe, expect, it, vi } from 'vitest';
import { makeMcpOAuthProvider, type McpOAuthState } from './mcp-oauth';

// Exact public discovery profiles captured in second-wave-discovery.json.
// These fixtures exercise the SDK without contacting or registering with a vendor.
const profiles = [
  {
    id: 'readwise', url: 'https://mcp2.readwise.io/mcp', resource: 'https://mcp2.readwise.io/mcp',
    resourceMetadataUrl: 'https://mcp2.readwise.io/.well-known/oauth-protected-resource/mcp',
    issuer: 'https://readwise.io/o/', metadataUrl: 'https://readwise.io/.well-known/oauth-authorization-server/o',
    registrationUrl: 'https://readwise.io/o/register/', authorizationUrl: 'https://readwise.io/o/authorize/',
    tokenUrl: 'https://readwise.io/o/token/', scopes: ['openid', 'read', 'write'],
    authMethods: ['none', 'client_secret_basic', 'client_secret_post'],
  },
  {
    id: 'raindrop', url: 'https://api.raindrop.io/rest/v2/ai/mcp', resource: 'https://api.raindrop.io/rest/v2',
    resourceMetadataUrl: 'https://api.raindrop.io/.well-known/oauth-protected-resource',
    issuer: 'https://api.raindrop.io', metadataUrl: 'https://api.raindrop.io/.well-known/oauth-authorization-server',
    registrationUrl: 'https://api.raindrop.io/v2/oauth/register', authorizationUrl: 'https://api.raindrop.io/v2/oauth/authorize',
    tokenUrl: 'https://api.raindrop.io/v2/oauth/access_token', scopes: ['read', 'write'],
    authMethods: ['client_secret_post', 'none'],
  },
];

describe('hosted knowledge connector OAuth discovery', () => {
  it.each(profiles)('honors the issuer path and resource identifier for $id', async (profile) => {
    expect(getHostedMcpProvider(profile.id)).toMatchObject({ url: profile.url });
    let saved: McpOAuthState = {};
    let revision = 0;
    const redirect = vi.fn();
    const provider = makeMcpOAuthProvider({
      redirectUrl: 'https://app.example/callback', clientName: 'Knowledge fixture', interactive: true,
      load: async () => structuredClone(saved),
      compareAndSave: async (expected, state) => {
        if (saved.revision !== expected) return null;
        saved = structuredClone({ ...state, revision: String(++revision) });
        return structuredClone(saved);
      },
      onRedirect: redirect,
    });
    const registrations: Record<string, unknown>[] = [];
    const fetchFixture = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === profile.registrationUrl && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        registrations.push(body);
        return Response.json({ ...body, client_id: 'knowledge-client' });
      }
      if (method !== 'GET') throw new Error(`Unexpected fixture request: ${method} ${url}`);
      if (url === profile.resourceMetadataUrl) return Response.json({
        resource: profile.resource, authorization_servers: [profile.issuer], scopes_supported: profile.scopes,
      });
      if (url === profile.metadataUrl) return Response.json({
        issuer: profile.issuer, authorization_endpoint: profile.authorizationUrl,
        token_endpoint: profile.tokenUrl, registration_endpoint: profile.registrationUrl,
        response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: profile.authMethods, code_challenge_methods_supported: ['S256'],
      });
      // Raindrop publishes root metadata, not metadata at the MCP transport path.
      if (profile.id === 'raindrop' && url.includes('/.well-known/oauth-protected-resource/')) {
        return new Response(null, { status: 404 });
      }
      throw new Error(`Unexpected fixture request: ${method} ${url}`);
    });

    expect(await auth(provider, { serverUrl: profile.url, fetchFn: fetchFixture })).toBe('REDIRECT');
    expect(registrations).toEqual([{
      client_name: 'Knowledge fixture', redirect_uris: ['https://app.example/callback'],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: 'none', scope: profile.scopes.join(' '),
    }]);
    const target = redirect.mock.calls[0][0] as URL;
    expect(`${target.origin}${target.pathname}`).toBe(profile.authorizationUrl);
    expect(target.searchParams.get('resource')).toBe(profile.resource);
    expect(target.searchParams.get('scope')).toBe(profile.scopes.join(' '));
    expect(target.searchParams.get('code_challenge_method')).toBe('S256');
    expect(target.searchParams.get('state')).toBe(saved.authorizationState);
    expect(saved.codeVerifier).toBeTruthy();
  });
});
