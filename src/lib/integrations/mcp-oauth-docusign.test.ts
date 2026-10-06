import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { beginMcpOAuth, finishMcpOAuth } from '@integrations/engine/mcp';
import { getHostedMcpProvider } from '@integrations/engine/providers';
import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeMcpOAuthProvider, type McpOAuthProviderDeps, type McpOAuthState } from './mcp-oauth';

interface CapturedProfile {
  id: string;
  endpoint: string;
  endpoint_status: number;
  www_authenticate: string | null;
  discovery: OAuthDiscoveryState;
}

// Discovery documents came from public GET requests. Anonymous initialize POSTs
// independently confirmed the same gateway 403. Every request in this file is an
// offline fixture, never a call to Docusign accounts.
const profiles = (JSON.parse(fs.readFileSync(new URL('../../../docs/integration-audit/sixth-wave-discovery.json', import.meta.url), 'utf8')) as {
  records: CapturedProfile[];
}).records.filter((profile) => profile.id.startsWith('docusign-'));

const clientId = 'fixture-docusign-integration-key';
const clientSecret = 'fixture-docusign-secret-key';
const redirectUri = 'https://app.example.com/api/integrations/mcp-oauth/callback';
const scopes = ['adm_store_unified_repo_read', 'aow_manage', 'cors', 'signature', 'spring_read', 'spring_write'];

function stateStore() {
  const policy = getHostedMcpProvider('docusign')!.auth;
  if (policy?.kind !== 'oauth' || policy.registration !== 'registered') throw new Error('Expected registered Docusign profile');
  let saved: McpOAuthState = {};
  let revision = 0;
  const replace = (next: McpOAuthState) => { saved = structuredClone({ ...next, revision: String(++revision) }); };
  const deps: McpOAuthProviderDeps = {
    redirectUrl: redirectUri,
    clientName: 'Docusign fixture',
    registeredClient: { clientId, clientSecret },
    tokenEndpointAuthMethod: policy.tokenEndpointAuthMethod,
    grantTypes: policy.grantTypes,
    scopes: policy.scopes,
    load: async () => structuredClone(saved),
    compareAndSave: async (expected, next) => {
      if (expected !== saved.revision) return null;
      replace(next);
      return structuredClone(saved);
    },
  };
  return {
    deps,
    saved: () => structuredClone(saved),
    consumeConsentState: () => {
      const next = structuredClone(saved);
      delete next.authorizationState;
      delete next.authorizationExpiresAt;
      replace(next);
    },
  };
}

function offlineServer(profile: CapturedProfile) {
  const origin = new URL(profile.endpoint).origin;
  const metadata = profile.discovery.authorizationServerMetadata!;
  const requests: { url: string; method: string; body: URLSearchParams; headers: Headers }[] = [];
  let tokenRequests = 0;
  const fetchFixture = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const request = { url, method, body: new URLSearchParams(String(init?.body ?? '')), headers: new Headers(init?.headers) };
    requests.push(request);
    if (method === 'GET') {
      if (url === `${origin}/.well-known/oauth-protected-resource/mcp`) return new Response('RBAC: access denied', { status: 403 });
      if (url === `${origin}/.well-known/oauth-protected-resource`) return Response.json(profile.discovery.resourceMetadata);
      if (url === `${origin}/.well-known/oauth-authorization-server`) return Response.json(metadata);
    }
    if (method === 'POST' && url === metadata.token_endpoint) {
      tokenRequests++;
      return Response.json({
        access_token: `fixture-access-${tokenRequests}`, refresh_token: `fixture-refresh-${tokenRequests}`, token_type: 'Bearer', expires_in: 3600,
      });
    }
    // No registration, authorization-page navigation, account, or tool endpoint
    // is implemented. An unexpected request fails instead of reaching the web.
    throw new Error(`Unexpected fixture request: ${method} ${url}`);
  });
  return { fetchFixture, requests };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('Docusign registered OAuth profile', () => {
  it('captures both independently selected environments without DCR metadata', () => {
    const definition = getHostedMcpProvider('docusign')!;
    expect(definition.auth).toMatchObject({ kind: 'oauth', registration: 'registered', tokenEndpointAuthMethod: 'client_secret_basic', authorizeBeforeConnect: true });
    expect(definition.defaultMutationRisk).toBe('high');
    expect(definition.url).toBeUndefined();
    if (definition.endpoint?.kind !== 'region') throw new Error('Expected explicit Docusign environment selection');
    expect(definition.endpoint.options.map((option) => option.url).sort()).toEqual(profiles.map((profile) => profile.endpoint).sort());
    expect(profiles.map((profile) => profile.id).sort()).toEqual(['docusign-demo', 'docusign-production']);
    for (const profile of profiles) {
      expect(profile.endpoint_status).toBe(403);
      expect(profile.www_authenticate).toBeNull();
      const metadata = profile.discovery.authorizationServerMetadata!;
      expect(metadata.registration_endpoint).toBeUndefined();
      expect(metadata.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
      expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
      expect(profile.discovery.resourceMetadata?.scopes_supported).toEqual(scopes);
      expect(profile.discovery.authorizationServerUrl).toBe(new URL(profile.endpoint).origin);
      expect(metadata.issuer).toBe(profile.id === 'docusign-demo' ? 'https://account-d.docusign.com' : 'https://account.docusign.com');
    }
  });

  it.each(profiles)('uses explicit consent, persisted discovery, PKCE, Basic code exchange and refresh for $id', async (profile) => {
    const store = stateStore();
    const remote = offlineServer(profile);
    const redirect = vi.fn();
    vi.stubGlobal('fetch', remote.fetchFixture);
    const provider = makeMcpOAuthProvider({ ...store.deps, interactive: true, onRedirect: redirect });
    expect(provider.saveClientInformation).toBeUndefined();

    expect(await beginMcpOAuth({ url: profile.endpoint, authProvider: provider })).toBe('REDIRECT');
    expect(remote.requests).toHaveLength(3);
    expect(remote.requests.every((request) => request.method === 'GET')).toBe(true);
    expect(remote.requests.map((request) => request.url)).toEqual([
      `${new URL(profile.endpoint).origin}/.well-known/oauth-protected-resource/mcp`,
      `${new URL(profile.endpoint).origin}/.well-known/oauth-protected-resource`,
      `${new URL(profile.endpoint).origin}/.well-known/oauth-authorization-server`,
    ]);
    const pending = store.saved();
    const target = redirect.mock.calls[0][0] as URL;
    expect(target.origin + target.pathname).toBe(profile.discovery.authorizationServerMetadata!.authorization_endpoint);
    expect(Object.fromEntries(target.searchParams)).toMatchObject({
      client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: scopes.join(' '),
      state: pending.authorizationState, resource: profile.endpoint, code_challenge_method: 'S256',
    });
    expect(target.searchParams.get('code_challenge')).toBe(createHash('sha256').update(pending.codeVerifier!).digest('base64url'));
    expect(target.href).not.toContain(clientSecret);
    expect(pending.discoveryState?.authorizationServerMetadata).toEqual(profile.discovery.authorizationServerMetadata);
    expect(pending.registeredClientFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(pending).not.toHaveProperty('clientInformation');

    // A fresh callback transport has no WWW-Authenticate challenge. The sealed
    // discovery state must retain the correct environment's account token URL.
    store.consumeConsentState();
    await finishMcpOAuth({ url: profile.endpoint, authProvider: makeMcpOAuthProvider(store.deps), authorizationCode: 'fixture-code' });
    expect(store.saved().tokens?.access_token).toBe('fixture-access-1');
    expect(await beginMcpOAuth({ url: profile.endpoint, authProvider: makeMcpOAuthProvider(store.deps) })).toBe('AUTHORIZED');
    expect(store.saved().tokens).toMatchObject({ access_token: 'fixture-access-2', refresh_token: 'fixture-refresh-2' });

    const exchanges = remote.requests.filter((request) => request.method === 'POST');
    expect(exchanges).toHaveLength(2);
    expect(Object.fromEntries(exchanges[0].body)).toMatchObject({
      grant_type: 'authorization_code', code: 'fixture-code', redirect_uri: redirectUri, code_verifier: pending.codeVerifier, resource: profile.endpoint,
    });
    expect(Object.fromEntries(exchanges[1].body)).toMatchObject({
      grant_type: 'refresh_token', refresh_token: 'fixture-refresh-1', resource: profile.endpoint,
    });
    for (const request of exchanges) {
      expect(request.url).toBe(profile.discovery.authorizationServerMetadata!.token_endpoint);
      expect(request.headers.get('Authorization')).toBe(`Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`);
      expect(request.body.has('client_secret')).toBe(false);
      expect(request.body.has('client_id')).toBe(false);
    }
    expect(remote.requests).toHaveLength(5);
    expect(store.saved()).not.toHaveProperty('codeVerifier');
    expect(JSON.stringify(store.saved())).not.toContain(clientSecret);
  });

  it.each(profiles)('does not reinterpret a transport 403 as a new sign-in for $id', async (profile) => {
    const store = stateStore();
    const redirect = vi.fn();
    // Both anonymous GET and initialize POST returned this gateway response.
    // It is not an OAuth challenge and must not become one globally.
    const denied = vi.fn<typeof fetch>(async () => new Response('RBAC: access denied', { status: 403 }));
    const transport = new StreamableHTTPClientTransport(new URL(profile.endpoint), {
      authProvider: makeMcpOAuthProvider({ ...store.deps, interactive: true, onRedirect: redirect }), fetch: denied,
    });
    await transport.start();
    try {
      await expect(transport.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).rejects.toBeInstanceOf(StreamableHTTPError);
      expect(denied).toHaveBeenCalledOnce();
      expect(redirect).not.toHaveBeenCalled();
      expect(store.saved().authorizationState).toBeUndefined();
    } finally {
      await transport.close();
    }
  });
});
