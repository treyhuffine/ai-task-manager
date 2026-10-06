import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { getHostedMcpProvider } from '@integrations/engine/providers';
import { auth, UnauthorizedError, type OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it, vi } from 'vitest';
import { makeMcpOAuthProvider, type McpOAuthProviderDeps, type McpOAuthState } from './mcp-oauth';

interface CapturedProfile {
  id: string;
  endpoint: string;
  endpoint_status: number;
  www_authenticate: string;
  discovery: OAuthDiscoveryState;
}

// Public GET-only metadata captured 2026-09-29. DCR and token responses below
// are offline fixtures, never registrations or account calls to Webflow.
const profile = (JSON.parse(fs.readFileSync(new URL('../../../docs/integration-audit/seventh-wave-discovery.json', import.meta.url), 'utf8')) as {
  records: CapturedProfile[];
}).records.find((record) => record.id === 'webflow')!;
const metadata = profile.discovery.authorizationServerMetadata!;

function setup(redirectUrl: string) {
  const policy = getHostedMcpProvider('webflow')?.auth ?? { kind: 'oauth' as const };
  if (policy.kind !== 'oauth') throw new Error('Expected Webflow OAuth profile');
  let saved: McpOAuthState = {};
  let revision = 0;
  const replace = (state: McpOAuthState) => { saved = structuredClone({ ...state, revision: String(++revision) }); };
  const deps: McpOAuthProviderDeps = {
    clientName: 'Independent Webflow fixture', redirectUrl,
    tokenEndpointAuthMethod: policy.tokenEndpointAuthMethod,
    grantTypes: policy.grantTypes, scopes: policy.scopes,
    load: async () => structuredClone(saved),
    compareAndSave: async (expected, state) => {
      if (expected !== saved.revision) return null;
      replace(state);
      return structuredClone(saved);
    },
  };
  return { deps, saved: () => structuredClone(saved), consumeState: () => {
    const consumed = structuredClone(saved);
    delete consumed.authorizationState;
    delete consumed.authorizationExpiresAt;
    replace(consumed);
  } };
}

function offlineServer() {
  const requests: { url: string; method: string; headers: Headers; body: string }[] = [];
  let exchanges = 0;
  const fetchFixture = vi.fn<typeof fetch>(async (input, init) => {
    const request = {
      url: String(input), method: init?.method ?? 'GET',
      headers: new Headers(init?.headers), body: String(init?.body ?? ''),
    };
    requests.push(request);
    if (request.method === 'POST' && request.url === profile.endpoint) return new Response(null, {
      status: 401, headers: { 'WWW-Authenticate': profile.www_authenticate },
    });
    if (request.method === 'GET' && request.url === 'https://mcp.webflow.com/.well-known/oauth-protected-resource/mcp') {
      return Response.json(profile.discovery.resourceMetadata);
    }
    if (request.method === 'GET' && request.url === 'https://mcp.webflow.com/.well-known/oauth-authorization-server') {
      return Response.json(metadata);
    }
    if (request.method === 'POST' && request.url === metadata.registration_endpoint) {
      return Response.json({ ...JSON.parse(request.body), client_id: 'fixture-webflow-client' });
    }
    if (request.method === 'POST' && request.url === metadata.token_endpoint) {
      return Response.json({
        access_token: `fixture-webflow-access-${++exchanges}`, refresh_token: `fixture-webflow-refresh-${exchanges}`,
        token_type: 'Bearer', expires_in: 3600,
      });
    }
    throw new Error(`Unexpected fixture request: ${request.method} ${request.url}`);
  });
  return { fetchFixture, requests };
}

describe('Webflow public hosted MCP OAuth profile', () => {
  it('matches the catalog to independently usable public DCR metadata without invented scopes', () => {
    const definition = getHostedMcpProvider('webflow');
    expect(definition).toMatchObject({ url: profile.endpoint, defaultMutationRisk: 'high' });
    const policy = definition?.auth ?? { kind: 'oauth' as const };
    if (policy.kind !== 'oauth') throw new Error('Expected Webflow OAuth profile');
    expect(policy.registration).not.toBe('registered');
    expect(policy.tokenEndpointAuthMethod ?? 'none').toBe('none');
    expect(policy.grantTypes ?? ['authorization_code', 'refresh_token']).toEqual(['authorization_code', 'refresh_token']);
    expect(policy.scopes).toBeUndefined();
    expect(profile.endpoint_status).toBe(401);
    expect(metadata.registration_endpoint).toBe('https://mcp.webflow.com/oauth/register');
    expect(metadata.token_endpoint_auth_methods_supported).toContain('none');
    expect(metadata.code_challenge_methods_supported).toContain('S256');
    expect(metadata.scopes_supported).toBeUndefined();
    expect(profile.discovery.resourceMetadata?.scopes_supported).toBeUndefined();
    expect(metadata.client_id_metadata_document_supported).toBe(false);
  });

  it.each([
    'https://app.example.com/api/integrations/mcp-oauth/server-fixture',
    'http://127.0.0.1:45123/mcp/callback',
  ])('uses public DCR, PKCE and fresh callback/refresh providers with %s', async (redirectUrl) => {
    const store = setup(redirectUrl);
    const remote = offlineServer();
    const redirect = vi.fn();
    const provider = makeMcpOAuthProvider({ ...store.deps, interactive: true, onRedirect: redirect });
    const initial = new StreamableHTTPClientTransport(new URL(profile.endpoint), { authProvider: provider, fetch: remote.fetchFixture });
    await initial.start();
    try {
      await expect(initial.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).rejects.toBeInstanceOf(UnauthorizedError);
    } finally {
      await initial.close();
    }

    const registration = remote.requests.filter((request) => request.url === metadata.registration_endpoint);
    expect(registration).toHaveLength(1);
    expect(JSON.parse(registration[0].body)).toEqual({
      client_name: store.deps.clientName, redirect_uris: [redirectUrl], response_types: ['code'],
      grant_types: ['authorization_code', 'refresh_token'], token_endpoint_auth_method: 'none',
    });
    const pending = store.saved();
    expect(pending.discoveryState?.authorizationServerMetadata).toEqual(metadata);
    expect(pending.discoveryState?.resourceMetadataUrl).toBe('https://mcp.webflow.com/.well-known/oauth-protected-resource/mcp');
    const target = redirect.mock.calls[0][0] as URL;
    expect(target.origin + target.pathname).toBe(metadata.authorization_endpoint);
    expect(Object.fromEntries(target.searchParams)).toMatchObject({
      client_id: 'fixture-webflow-client', redirect_uri: redirectUrl, response_type: 'code',
      resource: profile.endpoint, state: pending.authorizationState, code_challenge_method: 'S256',
    });
    expect(target.searchParams.has('scope')).toBe(false);
    expect(target.searchParams.get('code_challenge')).toBe(createHash('sha256').update(pending.codeVerifier!).digest('base64url'));
    expect(remote.requests).toHaveLength(4);

    store.consumeState();
    const callback = new StreamableHTTPClientTransport(new URL(profile.endpoint), {
      authProvider: makeMcpOAuthProvider(store.deps), fetch: remote.fetchFixture,
    });
    try {
      await callback.finishAuth('fixture-webflow-code');
    } finally {
      await callback.close();
    }
    expect(await auth(makeMcpOAuthProvider(store.deps), { serverUrl: profile.endpoint, fetchFn: remote.fetchFixture })).toBe('AUTHORIZED');
    const exchanges = remote.requests.filter((request) => request.url === metadata.token_endpoint);
    expect(exchanges).toHaveLength(2);
    expect(Object.fromEntries(new URLSearchParams(exchanges[0].body))).toMatchObject({
      grant_type: 'authorization_code', code: 'fixture-webflow-code', code_verifier: pending.codeVerifier,
      redirect_uri: redirectUrl, client_id: 'fixture-webflow-client', resource: profile.endpoint,
    });
    expect(Object.fromEntries(new URLSearchParams(exchanges[1].body))).toMatchObject({
      grant_type: 'refresh_token', refresh_token: 'fixture-webflow-refresh-1',
      client_id: 'fixture-webflow-client', resource: profile.endpoint,
    });
    for (const request of exchanges) {
      expect(request.headers.has('Authorization')).toBe(false);
      expect(new URLSearchParams(request.body).has('client_secret')).toBe(false);
      expect(new URLSearchParams(request.body).has('scope')).toBe(false);
    }
    expect(store.saved().tokens).toMatchObject({ access_token: 'fixture-webflow-access-2', refresh_token: 'fixture-webflow-refresh-2' });
    expect(store.saved().clientInformation?.client_id).toBe('fixture-webflow-client');
    expect(store.saved()).not.toHaveProperty('codeVerifier');
    expect(remote.requests).toHaveLength(6);
  });
});
