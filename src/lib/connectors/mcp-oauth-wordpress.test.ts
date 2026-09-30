import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { auth, UnauthorizedError, type OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { NeedsReauthError } from '@connectors/engine';
import { beginMcpOAuth, finishMcpOAuth } from '@connectors/engine/mcp';
import { getHostedMcpProvider } from '@connectors/engine/providers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeMcpOAuthProvider, type McpOAuthProviderDeps, type McpOAuthState } from './mcp-oauth';

interface CapturedProfile {
  id: string;
  endpoint: string;
  endpoint_status: number;
  www_authenticate: string;
  requests: { url: string; status: number }[];
  discovery: OAuthDiscoveryState;
}

// Public discovery capture only. Registration and token responses are synthetic,
// every request is intercepted, and no WordPress.com account is contacted.
const profile = (JSON.parse(fs.readFileSync(new URL('../../../docs/connector-audit/seventh-wave-discovery.json', import.meta.url), 'utf8')) as {
  records: CapturedProfile[];
}).records.find(record => record.id === 'wordpress')!;
const clientId = 'fixture-wordpress-client';
const redirectUri = 'http://127.0.0.1:45123/mcp/callback';

function setup() {
  let saved: McpOAuthState = {};
  let revision = 0;
  const replace = (state: McpOAuthState) => { saved = structuredClone({ ...state, revision: String(++revision) }); };
  const deps: McpOAuthProviderDeps = {
    redirectUrl: redirectUri, clientName: 'WordPress fixture', scopes: ['auth'],
    requireInteractiveAuthorization: true,
    load: async () => structuredClone(saved),
    compareAndSave: async (expected, state) => {
      if (saved.revision !== expected) return null;
      replace(state);
      return structuredClone(saved);
    },
  };
  return {
    deps, saved: () => structuredClone(saved),
    consumeState: () => {
      const next = structuredClone(saved);
      delete next.authorizationState;
      delete next.authorizationExpiresAt;
      replace(next);
    },
  };
}

function remote() {
  const metadata = profile.discovery.authorizationServerMetadata!;
  const registrations: Record<string, unknown>[] = [];
  const tokens: { body: URLSearchParams; headers: Headers }[] = [];
  let nextTokenError: 'invalid_client' | 'unauthorized_client' | 'invalid_grant' | undefined;
  const fetchFixture = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'POST' && url === profile.endpoint) return Response.json({ code: 'rest_unauthorized', message: 'Authentication required.', data: { status: 401 } }, {
      status: 401, headers: { 'WWW-Authenticate': profile.www_authenticate },
    });
    if (method === 'GET' && (url === profile.requests[1].url || url === 'https://public-api.wordpress.com/.well-known/oauth-protected-resource/wpcom/v2/mcp/v1')) {
      return Response.json(profile.discovery.resourceMetadata);
    }
    if (method === 'GET' && url === profile.requests[2].url) return Response.json(metadata);
    if (method === 'POST' && url === metadata.registration_endpoint) {
      const body = JSON.parse(String(init?.body));
      registrations.push(body);
      return Response.json({ ...body, client_id: clientId });
    }
    if (method === 'POST' && url === metadata.token_endpoint) {
      tokens.push({ body: new URLSearchParams(String(init?.body)), headers: new Headers(init?.headers) });
      if (nextTokenError) {
        const error = nextTokenError;
        nextTokenError = undefined;
        return Response.json({ error, error_description: 'Fixture credentials rejected' }, { status: 400 });
      }
      return Response.json({
        access_token: `fixture-access-${tokens.length}`, refresh_token: `fixture-refresh-${tokens.length}`,
        token_type: 'Bearer', expires_in: 3600, scope: 'auth',
      });
    }
    throw new Error(`Unexpected fixture request: ${method} ${url}`);
  });
  return {
    fetchFixture, registrations, tokens,
    rejectNextToken(error: NonNullable<typeof nextTokenError>) { nextTokenError = error; },
  };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('WordPress.com hosted OAuth', () => {
  it('matches the public client, PKCE and refresh discovery profile', () => {
    expect(getHostedMcpProvider('wordpress')).toMatchObject({ url: profile.endpoint, defaultMutationRisk: 'high' });
    expect(profile.endpoint_status).toBe(401);
    expect(profile.discovery.authorizationServerMetadata).toMatchObject({
      issuer: 'https://public-api.wordpress.com',
      authorization_endpoint: 'https://public-api.wordpress.com/oauth2-1/authorize',
      token_endpoint: 'https://public-api.wordpress.com/oauth2-1/token',
      registration_endpoint: 'https://public-api.wordpress.com/oauth2-1/register',
      registration_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
    });
    expect(profile.discovery.authorizationServerMetadata?.token_endpoint_auth_methods_supported).toContain('none');
    expect(profile.discovery.authorizationServerMetadata?.grant_types_supported).toEqual(['authorization_code', 'refresh_token', 'client_credentials']);
  });

  it('preserves query-based challenge discovery across callback and secretless refresh', async () => {
    const store = setup();
    const server = remote();
    const redirect = vi.fn();
    const provider = makeMcpOAuthProvider({ ...store.deps, interactive: true, onRedirect: redirect });
    const transport = new StreamableHTTPClientTransport(new URL(profile.endpoint), { authProvider: provider, fetch: server.fetchFixture });
    await transport.start();
    try {
      await expect(transport.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).rejects.toBeInstanceOf(UnauthorizedError);
    } finally { await transport.close(); }

    const pending = store.saved();
    const target = redirect.mock.calls[0][0] as URL;
    const advertisedScope = profile.discovery.resourceMetadata!.scopes_supported!.join(' ');
    // Client metadata is only a fallback. Without an explicit scope selection,
    // the installed SDK prioritizes the broader PRM scopes over ['auth'].
    expect(server.registrations).toEqual([{
      client_name: 'WordPress fixture', redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: 'none', scope: advertisedScope,
    }]);
    expect(target.origin + target.pathname).toBe('https://public-api.wordpress.com/oauth2-1/authorize');
    expect(Object.fromEntries(target.searchParams)).toMatchObject({
      client_id: clientId, redirect_uri: redirectUri, scope: advertisedScope, resource: profile.endpoint,
      state: pending.authorizationState, code_challenge_method: 'S256',
    });
    expect(target.searchParams.get('code_challenge')).toBe(createHash('sha256').update(pending.codeVerifier!).digest('base64url'));
    expect(pending.discoveryState?.resourceMetadataUrl).toBe(profile.requests[1].url);
    expect(pending.clientInformation).not.toHaveProperty('client_secret');

    store.consumeState();
    const callback = new StreamableHTTPClientTransport(new URL(profile.endpoint), {
      authProvider: makeMcpOAuthProvider(store.deps), fetch: server.fetchFixture,
    });
    try { await callback.finishAuth('fixture-code'); }
    finally { await callback.close(); }
    expect(await auth(makeMcpOAuthProvider(store.deps), { serverUrl: profile.endpoint, fetchFn: server.fetchFixture })).toBe('AUTHORIZED');
    expect(server.tokens).toHaveLength(2);
    expect(Object.fromEntries(server.tokens[0].body)).toMatchObject({
      client_id: clientId, grant_type: 'authorization_code', code: 'fixture-code',
      code_verifier: pending.codeVerifier, redirect_uri: redirectUri, resource: profile.endpoint,
    });
    expect(Object.fromEntries(server.tokens[1].body)).toMatchObject({
      client_id: clientId, grant_type: 'refresh_token', refresh_token: 'fixture-refresh-1', resource: profile.endpoint,
    });
    for (const token of server.tokens) {
      expect(token.body.has('client_secret')).toBe(false);
      expect(token.headers.has('Authorization')).toBe(false);
    }
    expect(server.registrations).toHaveLength(1);
    expect(server.fetchFixture.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === 'GET')).toHaveLength(2);
    expect(store.saved().tokens).toMatchObject({ access_token: 'fixture-access-2', refresh_token: 'fixture-refresh-2' });
    expect(store.saved()).not.toHaveProperty('codeVerifier');
  });

  it('uses the documented auth scope for both registration and consent when explicitly selected', async () => {
    const store = setup();
    const server = remote();
    const redirect = vi.fn();
    const provider = makeMcpOAuthProvider({ ...store.deps, interactive: true, onRedirect: redirect });
    const policy = getHostedMcpProvider('wordpress')!.auth;
    expect(policy).toMatchObject({ kind: 'oauth', scopes: ['auth'], authorizeBeforeConnect: true });
    if (policy?.kind !== 'oauth') throw new Error('Expected OAuth catalog policy');
    vi.stubGlobal('fetch', server.fetchFixture);
    expect(await beginMcpOAuth({ url: profile.endpoint, authProvider: provider, scope: policy.scopes?.join(' ') })).toBe('REDIRECT');
    expect(server.registrations).toHaveLength(1);
    expect(server.registrations[0]?.scope).toBe('auth');
    const target = redirect.mock.calls[0][0] as URL;
    expect(target.searchParams.get('scope')).toBe('auth');
    expect(target.searchParams.get('resource')).toBe(profile.endpoint);
    expect(String(server.fetchFixture.mock.calls[0]?.[0])).toBe('https://public-api.wordpress.com/.well-known/oauth-protected-resource/wpcom/v2/mcp/v1');
    expect(server.fetchFixture.mock.calls.some(([url]) => String(url) === profile.endpoint)).toBe(false);

    const pending = store.saved();
    store.consumeState();
    await finishMcpOAuth({ url: profile.endpoint, authProvider: makeMcpOAuthProvider(store.deps), authorizationCode: 'fixture-code' });
    expect(await beginMcpOAuth({ url: profile.endpoint, authProvider: makeMcpOAuthProvider(store.deps) })).toBe('AUTHORIZED');
    expect(server.tokens).toHaveLength(2);
    expect(Object.fromEntries(server.tokens[0].body)).toMatchObject({
      client_id: clientId, grant_type: 'authorization_code', code_verifier: pending.codeVerifier, resource: profile.endpoint,
    });
    expect(Object.fromEntries(server.tokens[1].body)).toMatchObject({
      client_id: clientId, grant_type: 'refresh_token', refresh_token: 'fixture-refresh-1', resource: profile.endpoint,
    });
    for (const token of server.tokens) {
      expect(token.body.has('client_secret')).toBe(false);
      expect(token.headers.has('Authorization')).toBe(false);
    }
    expect(store.saved().tokens).toMatchObject({ access_token: 'fixture-access-2', refresh_token: 'fixture-refresh-2', scope: 'auth' });
    expect(server.registrations).toHaveLength(1);
  });

  it.each(['invalid_client', 'unauthorized_client', 'invalid_grant'] as const)('requires a new interactive sign-in after background %s without registering broader access', async error => {
    const store = setup();
    const server = remote();
    const initialRedirect = vi.fn();
    expect(await auth(makeMcpOAuthProvider({ ...store.deps, interactive: true, onRedirect: initialRedirect }), {
      serverUrl: profile.endpoint, scope: 'auth', fetchFn: server.fetchFixture,
    })).toBe('REDIRECT');
    store.consumeState();
    expect(await auth(makeMcpOAuthProvider(store.deps), {
      serverUrl: profile.endpoint, authorizationCode: 'fixture-code', fetchFn: server.fetchFixture,
    })).toBe('AUTHORIZED');
    expect(store.saved()).not.toHaveProperty('authorizationState');
    expect(store.saved()).not.toHaveProperty('codeVerifier');

    const hiddenRedirect = vi.fn();
    server.rejectNextToken(error);
    await expect(auth(makeMcpOAuthProvider({ ...store.deps, onRedirect: hiddenRedirect }), {
      serverUrl: profile.endpoint, fetchFn: server.fetchFixture,
    })).rejects.toBeInstanceOf(NeedsReauthError);
    expect(hiddenRedirect).not.toHaveBeenCalled();
    expect(server.registrations).toHaveLength(1);
    expect(server.registrations[0]?.scope).toBe('auth');
    expect(server.tokens).toHaveLength(2);
    const rejected = store.saved();
    expect(rejected).not.toHaveProperty('tokens');
    expect(rejected).not.toHaveProperty('authorizationState');
    expect(rejected).not.toHaveProperty('authorizationExpiresAt');
    expect(rejected).not.toHaveProperty('codeVerifier');
    if (error === 'invalid_grant') expect(rejected.clientInformation?.client_id).toBe(clientId);
    else expect(rejected).not.toHaveProperty('clientInformation');

    // Repeated background calls cannot start a hidden registration or consent,
    // even after the SDK has invalidated the failed credentials.
    await expect(auth(makeMcpOAuthProvider({ ...store.deps, onRedirect: hiddenRedirect }), {
      serverUrl: profile.endpoint, fetchFn: server.fetchFixture,
    })).rejects.toBeInstanceOf(NeedsReauthError);
    expect(server.registrations).toHaveLength(1);
    expect(server.tokens).toHaveLength(2);
    expect(hiddenRedirect).not.toHaveBeenCalled();

    // The trusted interactive host can restart with the documented narrow scope.
    const renewedRedirect = vi.fn();
    vi.stubGlobal('fetch', server.fetchFixture);
    expect(await beginMcpOAuth({
      authProvider: makeMcpOAuthProvider({ ...store.deps, interactive: true, onRedirect: renewedRedirect }),
      url: profile.endpoint, scope: 'auth',
    })).toBe('REDIRECT');
    expect(server.registrations).toHaveLength(error === 'invalid_grant' ? 1 : 2);
    expect(server.registrations.every(registration => registration.scope === 'auth')).toBe(true);
    expect((renewedRedirect.mock.calls[0][0] as URL).searchParams.get('scope')).toBe('auth');
    expect(store.saved().authorizationState).toBeTruthy();
    expect(store.saved().codeVerifier).toBeTruthy();
  });
});
