import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { getHostedMcpProvider, PROVIDER_CATALOG } from '@integrations/engine/providers';
import { INTEGRATION_ICONS } from '@/components/integrations/integration-icon-data';
import { INTEGRATION_META, starterPrompt } from '@/components/integrations/integration-meta';
import { makeMcpOAuthProvider, type McpOAuthProviderDeps, type McpOAuthState } from './mcp-oauth';

vi.mock('@/lib/db/queries', () => ({ getWorkspace: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); });

const endpoint = 'https://api.magicpath.ai/mcp';
// MagicPath's public discovery, as served unauthenticated on October 19, 2026
// (docs/integration-audit/magicpath.md). Every response here is an intercepted fixture.
const challenge = 'Bearer resource_metadata="https://api.magicpath.ai/.well-known/oauth-protected-resource/mcp", error="invalid_token", error_description="A valid MagicPath MCP access token is required."';
const resourceMetadata = { resource: endpoint, authorization_servers: ['https://api.magicpath.ai/'], scopes_supported: ['magicpath:read', 'magicpath:write'], resource_name: 'MagicPath MCP' };
const metadata = {
  issuer: 'https://api.magicpath.ai/', authorization_endpoint: 'https://api.magicpath.ai/authorize', response_types_supported: ['code'],
  code_challenge_methods_supported: ['S256'], token_endpoint: 'https://api.magicpath.ai/token', token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
  grant_types_supported: ['authorization_code', 'refresh_token'], scopes_supported: ['magicpath:read', 'magicpath:write'],
  revocation_endpoint: 'https://api.magicpath.ai/revoke', revocation_endpoint_auth_methods_supported: ['client_secret_post'], registration_endpoint: 'https://api.magicpath.ai/register',
};

describe('MagicPath connector', () => {
  it('is an official hosted service with public OAuth discovery, its logo and its own starter prompt', () => {
    expect(PROVIDER_CATALOG.find(provider => provider.id === 'magicpath')).toEqual({ id: 'magicpath', displayName: 'MagicPath', method: 'mcp' });
    // No auth profile: the same public discovery as Todoist, which the user's custom connection already completed.
    expect(getHostedMcpProvider('magicpath')).toEqual({ id: 'magicpath', displayName: 'MagicPath', url: endpoint });
    expect(INTEGRATION_META.magicpath).toMatchObject({ category: 'Developer', brandHex: '085C34' });
    expect(INTEGRATION_ICONS.magicpath).toMatchObject({ title: 'MagicPath', hex: '085C34' });
    expect(INTEGRATION_ICONS.magicpath.path).toMatch(/^M[\d. CLZM]+Z$/);
    expect(starterPrompt('magicpath', 'MagicPath')).toBe('Create a responsive landing page in MagicPath.');
    expect(starterPrompt('todoist', 'Todoist')).toBe('What’s on my list today?');
    expect(starterPrompt('mcp_magicpath_demo', 'MagicPath Demo')).toBe('What can you do with MagicPath Demo?');
    for (const prompt of Object.values(INTEGRATION_META).flatMap(meta => meta.starterPrompt ?? [])) {
      // OpenAI's directory rules for starter prompts: one line, at most 128 characters, no mention.
      expect(prompt.length).toBeLessThanOrEqual(128);
      expect(prompt).not.toMatch(/[\n@]/);
    }
  });

  it.each([
    { channel: 'web' as const, redirectUrl: 'https://ri.example/api/integrations/mcp-oauth/fixture' },
    { channel: 'desktop' as const, redirectUrl: 'http://127.0.0.1:45123/mcp/callback' },
  ])('signs in from its challenge with dynamic registration, PKCE and both scopes, then refreshes ($channel)', async ({ channel, redirectUrl }) => {
    let saved: McpOAuthState = {};
    let revision = 0;
    const deps: McpOAuthProviderDeps = {
      redirectUrl, callbackChannel: channel, clientName: 'Ri',
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
      if (url === 'https://api.magicpath.ai/.well-known/oauth-protected-resource/mcp') return Response.json(resourceMetadata);
      if (url === 'https://api.magicpath.ai/.well-known/oauth-authorization-server') return Response.json(metadata);
      if (url === metadata.registration_endpoint && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        registrations.push(body);
        return Response.json({ ...body, client_id: 'magicpath-fixture-client' });
      }
      if (url === metadata.token_endpoint && method === 'POST') {
        exchanges.push(new URLSearchParams(String(init?.body)));
        return Response.json({ access_token: `fixture-access-${exchanges.length}`, refresh_token: `fixture-refresh-${exchanges.length}`, token_type: 'Bearer', scope: 'magicpath:read magicpath:write' });
      }
      throw new Error(`Unexpected fixture request: ${method} ${url}`);
    });
    const redirect = vi.fn();
    vi.stubGlobal('fetch', fetchFixture);
    // What the transport does with the 401: discover from the challenge's resource metadata.
    const resourceMetadataUrl = new URL(/resource_metadata="([^"]+)"/.exec(challenge)![1]);
    expect(await auth(makeMcpOAuthProvider({ ...deps, interactive: true, onRedirect: redirect }), { serverUrl: endpoint, resourceMetadataUrl, fetchFn: fetchFixture })).toBe('REDIRECT');
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({ client_name: 'Ri', redirect_uris: [redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
    const consent = redirect.mock.calls[0][0] as URL;
    expect(`${consent.origin}${consent.pathname}`).toBe(metadata.authorization_endpoint);
    expect(consent.searchParams.get('scope')).toBe('magicpath:read magicpath:write');
    expect(consent.searchParams.get('resource')).toBe(endpoint);
    expect(consent.searchParams.get('state')).toBe(saved.authorizationState);
    const verifier = saved.codeVerifier!;
    expect(consent.searchParams.get('code_challenge_method')).toBe('S256');
    expect(consent.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(await auth(makeMcpOAuthProvider(deps), { serverUrl: endpoint, resourceMetadataUrl, authorizationCode: 'fixture-code', fetchFn: fetchFixture })).toBe('AUTHORIZED');
    expect(Object.fromEntries(exchanges[0])).toMatchObject({ grant_type: 'authorization_code', client_id: 'magicpath-fixture-client', code_verifier: verifier, redirect_uri: redirectUrl, resource: endpoint });
    expect(await auth(makeMcpOAuthProvider(deps), { serverUrl: endpoint, resourceMetadataUrl, fetchFn: fetchFixture })).toBe('AUTHORIZED');
    expect(Object.fromEntries(exchanges[1])).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'fixture-refresh-1', resource: endpoint });
    expect(registrations).toHaveLength(1);
    expect(saved.tokens?.access_token).toBe('fixture-access-2');
  });
});
