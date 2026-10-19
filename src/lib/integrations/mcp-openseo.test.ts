import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auth } from '@modelcontextprotocol/client';
import { beginMcpOAuth, connectMcpClient, ingestMcpServer, type McpToolDef } from '@integrations/engine/mcp';
import { createRegistry } from '@integrations/engine';
import { getHostedMcpProvider, PROVIDER_CATALOG } from '@integrations/engine/providers';
import { inMemoryStore, plaintextSecretBox } from '@integrations/engine/testing';
import { INTEGRATION_META } from '@/components/integrations/integration-meta';
import { makeMcpOAuthProvider, type McpOAuthProviderDeps, type McpOAuthState } from './mcp-oauth';
import { mcpAuthHeaders } from './runtime';
import { defaultApprovalMode } from './write-policy';
import { expectedApplicationType } from '@/test/fixtures/oauth';

vi.mock('@/lib/db/queries', () => ({ getWorkspace: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); });

const endpoint = 'https://app.openseo.so/mcp';
const key = 'oseo_fixture_key';
// Source-derived public profile and annotations from every-app/open-seo at
// 89e5a00717cdf049b7c2b4e29646edb3a7d4995b. All responses are intercepted fixtures.
const resourceMetadata = { resource: endpoint, authorization_servers: ['https://app.openseo.so'], scopes_supported: ['mcp'] };
const metadata = {
  issuer: 'https://app.openseo.so',
  authorization_endpoint: 'https://app.openseo.so/api/auth/oauth2/authorize',
  token_endpoint: 'https://app.openseo.so/api/auth/oauth2/token',
  registration_endpoint: 'https://app.openseo.so/api/auth/oauth2/register',
  response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
  token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
  scopes_supported: ['offline_access', 'mcp'], code_challenge_methods_supported: ['S256'],
};
const tools: McpToolDef[] = [
  { name: 'list_projects', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: 'research_keywords', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } },
  { name: 'set_report_sharing', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true } },
];

describe('OpenSEO connector', () => {
  it('exposes the official service with OAuth, API-key setup and the SEO catalog category', () => {
    expect(PROVIDER_CATALOG.find(provider => provider.id === 'openseo')).toMatchObject({ displayName: 'OpenSEO', method: 'mcp' });
    expect(getHostedMcpProvider('openseo')).toMatchObject({
      endpoint: { kind: 'deployment', hostedUrl: endpoint, path: '/mcp' }, auth: { kind: 'oauth', scopes: ['mcp', 'offline_access'], tokenEndpointAuthMethod: 'none', authorizeBeforeConnect: true },
      tokenAuth: { label: 'OpenSEO API key', helpUrl: 'https://app.openseo.so/settings' },
    });
    expect(getHostedMcpProvider('openseo')?.defaultMutationRisk).toBeUndefined();
    expect(getHostedMcpProvider('openseo')).not.toHaveProperty('maxConcurrentCalls');
    expect(INTEGRATION_META.openseo).toMatchObject({ category: 'Websites & publishing', docsUrl: 'https://www.openseo.so/docs/mcp' });
  });

  it.each([{ deployment: 'hosted API key', url: endpoint, secret: key }, { deployment: 'self-hosted Docker', url: 'http://localhost:3000/mcp', secret: undefined }])('uses $deployment through the real SDK for discovery and tool dispatch', async ({ url, secret }) => {
    const methods: string[] = [];
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      expect(request.url).toBe(url);
      expect(request.headers.get('Authorization')).toBe(secret ? `Bearer ${secret}` : null);
      if (request.method === 'GET') return new Response(null, { status: 405 });
      const message = await request.json() as { id?: number; method: string };
      methods.push(message.method);
      if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
      // A 2025-era server answers Ri's 2026-07-28 probe as an unknown method.
      if (message.method === 'server/discover') return Response.json({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
      const result = message.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'OpenSEO', version: 'fixture' } }
        : message.method === 'tools/list' ? { tools }
          : { content: [{ type: 'text', text: 'Projects' }], structuredContent: { projects: [{ id: 'fixture-project' }] } };
      return Response.json({ jsonrpc: '2.0', id: message.id, result });
    }));
    const client = await connectMcpClient({ url, ...(secret ? { headers: mcpAuthHeaders({ kind: 'bearer' }, secret) } : {}) });
    try {
      expect(await client.listTools()).toEqual({ tools });
      expect(await client.callTool({ name: 'list_projects' })).toMatchObject({ structuredContent: { projects: [{ id: 'fixture-project' }] } });
      expect(methods).toEqual(['server/discover', 'initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
    } finally { await client.close(); }
  });

  it('does not reinterpret a rejected API key as an OAuth setup or retry a paid request', async () => {
    const fetchFixture = vi.fn<typeof fetch>(async (input, init) => {
      expect(new Request(input, init).url).toBe(endpoint);
      return new Response('Invalid API key', { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
    });
    vi.stubGlobal('fetch', fetchFixture);
    await expect(connectMcpClient({ url: endpoint, headers: mcpAuthHeaders({ kind: 'bearer' }, key) })).rejects.toMatchObject({ status: 401 });
    expect(fetchFixture).toHaveBeenCalledOnce();
  });

  it('keeps credit-backed research available while preserving the provider sharing approval gate', async () => {
    const registry = createRegistry();
    await ingestMcpServer(registry, inMemoryStore(), plaintextSecretBox(), {
      name: 'builtin_openseo', identity: { providerId: 'openseo', displayName: 'OpenSEO' }, trustToolAnnotations: true,
      client: { listTools: async () => ({ tools }), callTool: async () => ({ content: [] }) },
    });
    const projects = registry.getAction('openseo.list_projects')!.action;
    const research = registry.getAction('openseo.research_keywords')!.action;
    const sharing = registry.getAction('openseo.set_report_sharing')!.action;
    expect(projects).toMatchObject({ mutating: false, risk: 'low' });
    expect(research).toMatchObject({ mutating: true, risk: 'medium' });
    expect(sharing).toMatchObject({ mutating: true, risk: 'high' });
    expect(defaultApprovalMode({ actionId: research.id, risk: research.risk!, mutating: true })).toBe('auto');
    expect(defaultApprovalMode({ actionId: sharing.id, risk: sharing.risk!, mutating: true })).toBe('ask');
  });

  it.each([
    { channel: 'web' as const, redirectUrl: 'https://ri.example/api/integrations/mcp-oauth/fixture' },
    { channel: 'desktop' as const, redirectUrl: 'http://127.0.0.1:45123/mcp/callback' },
  ])('uses public DCR, PKCE and offline refresh for $channel', async ({ channel, redirectUrl }) => {
    const profile = getHostedMcpProvider('openseo')!.auth!;
    if (profile.kind !== 'oauth') throw new Error('Expected OAuth profile');
    let saved: McpOAuthState = {};
    let revision = 0;
    const deps: McpOAuthProviderDeps = {
      redirectUrl, callbackChannel: channel, clientName: 'OpenSEO fixture', scopes: profile.scopes,
      tokenEndpointAuthMethod: profile.tokenEndpointAuthMethod,
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
      if (url === 'https://app.openseo.so/.well-known/oauth-protected-resource/mcp') return Response.json(resourceMetadata);
      if (url === 'https://app.openseo.so/.well-known/oauth-authorization-server') return Response.json(metadata);
      if (url === metadata.registration_endpoint && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        registrations.push(body);
        return Response.json({ ...body, client_id: 'openseo-fixture-client' });
      }
      if (url === metadata.token_endpoint && method === 'POST') {
        const body = new URLSearchParams(String(init?.body));
        expect(body.has('client_secret')).toBe(false);
        expect(new Headers(init?.headers).has('Authorization')).toBe(false);
        exchanges.push(body);
        return Response.json({ access_token: `fixture-access-${exchanges.length}`, refresh_token: `fixture-refresh-${exchanges.length}`, token_type: 'Bearer', scope: 'mcp offline_access' });
      }
      throw new Error(`Unexpected fixture request: ${method} ${url}`);
    });
    const redirect = vi.fn();
    vi.stubGlobal('fetch', fetchFixture);
    expect(await beginMcpOAuth({ url: endpoint, authProvider: makeMcpOAuthProvider({ ...deps, interactive: true, onRedirect: redirect }), scope: profile.scopes?.join(' ') })).toBe('REDIRECT');
    expect(registrations).toEqual([{
      client_name: 'OpenSEO fixture', redirect_uris: [redirectUrl], application_type: expectedApplicationType(redirectUrl), grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'mcp offline_access',
    }]);
    const consent = redirect.mock.calls[0][0] as URL;
    expect(`${consent.origin}${consent.pathname}`).toBe(metadata.authorization_endpoint);
    expect(consent.searchParams.get('scope')).toBe('mcp offline_access');
    expect(consent.searchParams.get('resource')).toBe(endpoint);
    expect(consent.searchParams.get('state')).toBe(saved.authorizationState);
    const verifier = saved.codeVerifier!;
    expect(consent.searchParams.get('code_challenge_method')).toBe('S256');
    expect(consent.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(await auth(makeMcpOAuthProvider(deps), { serverUrl: endpoint, authorizationCode: 'fixture-code', fetchFn: fetchFixture })).toBe('AUTHORIZED');
    expect(Object.fromEntries(exchanges[0])).toMatchObject({ grant_type: 'authorization_code', client_id: 'openseo-fixture-client', code_verifier: verifier, redirect_uri: redirectUrl, resource: endpoint });
    expect(await auth(makeMcpOAuthProvider(deps), { serverUrl: endpoint, fetchFn: fetchFixture })).toBe('AUTHORIZED');
    expect(Object.fromEntries(exchanges[1])).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'fixture-refresh-1', resource: endpoint });
    expect(registrations).toHaveLength(1);
    expect(saved.tokens?.access_token).toBe('fixture-access-2');
  });
});
