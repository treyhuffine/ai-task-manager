import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auth, extractWWWAuthenticateParams, UnauthorizedError, type OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createRedactor, fileLock, NeedsReauthError } from '@connectors/engine';
import { aesGcmSecretBox, generateSecretKey } from '@connectors/engine/crypto';
import { getHostedMcpProvider } from '@connectors/engine/providers';
import { describe, expect, it, vi } from 'vitest';
import { makeMcpOAuthProvider, type McpOAuthProviderDeps, type McpOAuthState } from './mcp-oauth';
import { mcpServerStore } from './mcp-servers';

const serverUrl = 'https://mcp.example.com/mcp';
const issuer = 'https://oauth.example.com';
const tokenUrl = `${issuer}/token`;
const clientId = 'registered-fixture-client';
const clientSecret = 'registered-fixture-secret';
const client = { clientId, clientSecret };
const tokens = { access_token: 'fixture-access', refresh_token: 'fixture-refresh', token_type: 'Bearer' };

function discovery(method: 'none' | 'client_secret_basic' | 'client_secret_post' = 'client_secret_basic'): OAuthDiscoveryState {
  return {
    authorizationServerUrl: issuer,
    resourceMetadata: { resource: serverUrl, authorization_servers: [issuer] },
    authorizationServerMetadata: {
      issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: tokenUrl,
      registration_endpoint: `${issuer}/register`, response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: [method],
    },
  };
}

function setup(initial: McpOAuthState = {}, overrides: Partial<McpOAuthProviderDeps> = {}) {
  let saved = structuredClone(initial);
  let revision = 0;
  const replace = async (value: McpOAuthState) => { saved = structuredClone({ ...value, revision: String(++revision) }); };
  const redactor = createRedactor();
  const deps: McpOAuthProviderDeps = {
    redirectUrl: 'https://app.example.com/mcp/callback', clientName: 'Registered client fixture',
    registeredClient: client, tokenEndpointAuthMethod: 'client_secret_basic', discoveryState: discovery(),
    load: async () => structuredClone(saved),
    compareAndSave: async (expected, value) => {
      if (expected !== saved.revision) return null;
      await replace(value);
      return structuredClone(saved);
    },
    onState: (state) => {
      const info = state.clientInformation;
      if (info && 'client_secret' in info && typeof info.client_secret === 'string') redactor.register(info.client_secret);
      if (state.tokens?.access_token) redactor.register(state.tokens.access_token);
      if (state.tokens?.refresh_token) redactor.register(state.tokens.refresh_token);
      if (state.codeVerifier) redactor.register(state.codeVerifier);
    },
    ...overrides,
  };
  return { deps, redactor, saved: () => structuredClone(saved), replace };
}

async function seedTokens(s: ReturnType<typeof setup>) {
  const provider = makeMcpOAuthProvider(s.deps);
  await provider.clientInformation();
  await provider.saveTokens(tokens);
  return provider;
}

async function consumeState(s: ReturnType<typeof setup>) {
  const consumed = s.saved();
  delete consumed.authorizationState;
  delete consumed.authorizationExpiresAt;
  await s.replace(consumed);
}

// Public GET discovery captures only. Every request below is an offline fixture,
// including registration URLs advertised by providers that require static clients.
const capturedProfiles = (JSON.parse(fs.readFileSync(new URL('../../../docs/connector-audit/fifth-wave-discovery.json', import.meta.url), 'utf8')) as {
  records: {
    id: string; endpoint: string; www_authenticate: string | null;
    requests: { url: string; status: number }[]; discovery: OAuthDiscoveryState;
  }[];
}).records;

describe('registered MCP OAuth clients', () => {
  it.each(capturedProfiles)('exercises $id catalog discovery, consent, callback and refresh through the SDK', async (profile) => {
    const definition = getHostedMcpProvider(profile.id)!;
    expect(definition.url).toBe(profile.endpoint);
    if (definition.auth?.kind !== 'oauth' || definition.auth.registration !== 'registered') {
      throw new Error('Expected registered catalog profile');
    }
    const policy = definition.auth;
    const metadata = profile.discovery.authorizationServerMetadata!;
    expect(metadata.token_endpoint_auth_methods_supported).toContain(policy.tokenEndpointAuthMethod);
    const s = setup({}, {
      discoveryState: undefined, tokenEndpointAuthMethod: policy.tokenEndpointAuthMethod,
      grantTypes: policy.grantTypes, scopes: policy.scopes, authorizationParams: policy.authorizationParams,
    });
    const redirect = vi.fn();
    const tokenRequests: { body: URLSearchParams; headers: Headers }[] = [];
    const fetchFixture = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'POST' && url === profile.endpoint) return new Response(null, {
        status: 401, headers: profile.www_authenticate ? { 'WWW-Authenticate': profile.www_authenticate } : {},
      });
      if (method === 'GET' && url === profile.requests[1].url) return Response.json(profile.discovery.resourceMetadata);
      if (method === 'GET' && url === profile.requests[2].url) return Response.json(metadata);
      if (method === 'POST' && url === metadata.token_endpoint) {
        tokenRequests.push({ body: new URLSearchParams(String(init?.body)), headers: new Headers(init?.headers) });
        return Response.json({ ...tokens, access_token: `fixture-${profile.id}-${tokenRequests.length}` });
      }
      throw new Error(`Unexpected fixture request: ${method} ${url}`);
    });
    const initialOptions = profile.www_authenticate
      ? extractWWWAuthenticateParams(new Response(null, { status: 401, headers: { 'WWW-Authenticate': profile.www_authenticate } }))
      : {};
    const interactive = makeMcpOAuthProvider({ ...s.deps, interactive: true, onRedirect: redirect });
    // The real HTTP transport reads tokens before handling its first 401 challenge.
    const initialTransport = new StreamableHTTPClientTransport(new URL(profile.endpoint), { authProvider: interactive, fetch: fetchFixture });
    await initialTransport.start();
    await expect(initialTransport.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).rejects.toBeInstanceOf(UnauthorizedError);
    await initialTransport.close();
    const target = redirect.mock.calls[0][0] as URL;
    const pending = s.saved();
    expect(target.origin + target.pathname).toBe(metadata.authorization_endpoint);
    expect(target.searchParams.get('client_id')).toBe(clientId);
    const requestedScopes = profile.discovery.resourceMetadata?.scopes_supported?.join(' ') || policy.scopes?.join(' ') || null;
    expect(target.searchParams.get('scope')).toBe(requestedScopes);
    expect(target.searchParams.get('resource')).toBe(new URL(profile.discovery.resourceMetadata!.resource).href);
    expect(target.searchParams.get('state')).toBe(pending.authorizationState);
    expect(target.searchParams.get('code_challenge')).toBe(createHash('sha256').update(pending.codeVerifier!).digest('base64url'));
    expect(target.searchParams.get('code_challenge_method')).toBe('S256');
    for (const [key, value] of Object.entries(policy.authorizationParams ?? {})) expect(target.searchParams.get(key)).toBe(value);
    expect(target.href).not.toContain(clientSecret);
    expect(pending.discoveryState?.authorizationServerMetadata?.token_endpoint).toBe(metadata.token_endpoint);
    if (initialOptions.resourceMetadataUrl) expect(pending.discoveryState?.resourceMetadataUrl).toBe(String(initialOptions.resourceMetadataUrl));
    expect(fetchFixture).toHaveBeenCalledTimes(3);

    // Browser callbacks create a fresh transport without the initial challenge.
    // Asana's /v2 resource-metadata path must survive this boundary.
    await consumeState(s);
    const callbackTransport = new StreamableHTTPClientTransport(new URL(profile.endpoint), {
      authProvider: makeMcpOAuthProvider(s.deps), fetch: fetchFixture,
    });
    await callbackTransport.finishAuth('fixture-code');
    await callbackTransport.close();
    expect(await auth(makeMcpOAuthProvider(s.deps), {
      serverUrl: profile.endpoint, fetchFn: fetchFixture,
    })).toBe('AUTHORIZED');
    expect(tokenRequests).toHaveLength(2);
    expect(Object.fromEntries(tokenRequests[0].body)).toMatchObject({
      grant_type: 'authorization_code', code: 'fixture-code', code_verifier: pending.codeVerifier, redirect_uri: s.deps.redirectUrl,
    });
    expect(Object.fromEntries(tokenRequests[1].body)).toMatchObject({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
    for (const request of tokenRequests) {
      if (policy.tokenEndpointAuthMethod === 'client_secret_basic') {
        expect(request.headers.get('Authorization')).toBe(`Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`);
        expect(request.body.has('client_secret')).toBe(false);
      } else {
        expect(request.headers.has('Authorization')).toBe(false);
        expect(Object.fromEntries(request.body)).toMatchObject({ client_id: clientId, client_secret: clientSecret });
      }
    }
    expect(fetchFixture).toHaveBeenCalledTimes(5);
    expect(s.saved()).not.toHaveProperty('clientInformation');
    expect(JSON.stringify(s.saved())).not.toContain(clientSecret);
  });

  it.each(['none', 'client_secret_basic', 'client_secret_post'] as const)(
    'uses %s for SDK PKCE, code exchange and refresh without discovery or registration', async (method) => {
      const s = setup({ redirectUri: 'https://old.example.com/callback' }, {
        registeredClient: { clientId, ...(method === 'none' ? {} : { clientSecret }) },
        tokenEndpointAuthMethod: method, discoveryState: discovery(method),
        scopes: ['content.read', 'offline_access'], authorizationParams: { token_access_type: 'offline' },
      });
      const redirect = vi.fn();
      const requests: { body: URLSearchParams; headers: Headers }[] = [];
      const fetchFixture = vi.fn<typeof fetch>(async (input, init) => {
        // A complete trusted metadata profile allows no discovery or DCR calls.
        expect(String(input)).toBe(tokenUrl);
        expect(init?.method).toBe('POST');
        requests.push({ body: new URLSearchParams(String(init?.body)), headers: new Headers(init?.headers) });
        return Response.json({ ...tokens, access_token: `fixture-access-${requests.length}`, refresh_token: `fixture-refresh-${requests.length}` });
      });
      const interactive = makeMcpOAuthProvider({ ...s.deps, interactive: true, onRedirect: redirect });
      expect(interactive.saveClientInformation).toBeUndefined();
      expect(await interactive.clientInformation()).toMatchObject({ client_id: clientId });
      expect(await auth(interactive, { serverUrl, fetchFn: fetchFixture })).toBe('REDIRECT');
      expect(fetchFixture).not.toHaveBeenCalled();
      const pending = s.saved();
      const target = redirect.mock.calls[0][0] as URL;
      expect(target.origin + target.pathname).toBe(`${issuer}/authorize`);
      expect(Object.fromEntries(target.searchParams)).toMatchObject({
        client_id: clientId, redirect_uri: s.deps.redirectUrl, response_type: 'code', state: pending.authorizationState,
        scope: 'content.read offline_access', code_challenge_method: 'S256', token_access_type: 'offline', prompt: 'consent',
      });
      expect(target.searchParams.get('code_challenge')).toBe(createHash('sha256').update(pending.codeVerifier!).digest('base64url'));
      expect(target.href).not.toContain(clientSecret);
      expect(pending).not.toHaveProperty('clientInformation');
      expect(pending.registeredClientFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(pending)).not.toContain(clientSecret);
      if (method !== 'none') expect(s.redactor.redact(clientSecret)).toBe('[redacted]');
      expect(s.redactor.redact(pending.codeVerifier!)).toBe('[redacted]');

      await consumeState(s);
      const callback = makeMcpOAuthProvider(s.deps);
      expect(await auth(callback, { serverUrl, authorizationCode: 'fixture-code', fetchFn: fetchFixture })).toBe('AUTHORIZED');
      expect(Object.fromEntries(requests[0].body)).toMatchObject({
        grant_type: 'authorization_code', code: 'fixture-code', code_verifier: pending.codeVerifier, redirect_uri: s.deps.redirectUrl,
      });
      expect(s.saved()).not.toHaveProperty('codeVerifier');
      expect(await auth(makeMcpOAuthProvider(s.deps), { serverUrl, fetchFn: fetchFixture })).toBe('AUTHORIZED');
      expect(Object.fromEntries(requests[1].body)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'fixture-refresh-1' });
      for (const request of requests) {
        if (method === 'client_secret_basic') {
          expect(request.headers.get('Authorization')).toBe(`Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`);
          expect(request.body.has('client_id')).toBe(false);
          expect(request.body.has('client_secret')).toBe(false);
        } else {
          expect(request.headers.has('Authorization')).toBe(false);
          expect(request.body.get('client_id')).toBe(clientId);
          expect(request.body.get('client_secret')).toBe(method === 'none' ? null : clientSecret);
        }
      }
      expect(s.saved().tokens).toMatchObject({ access_token: 'fixture-access-2', refresh_token: 'fixture-refresh-2' });
      expect(s.saved().registeredClientFingerprint).toBe(pending.registeredClientFingerprint);
      expect(JSON.stringify(s.saved())).not.toContain(clientSecret);
      expect(s.redactor.redact('fixture-access-2 fixture-refresh-2')).toBe('[redacted] [redacted]');
    },
  );

  it('uses normal SDK metadata discovery while never registering a static client', async () => {
    const s = setup({}, { discoveryState: undefined });
    const metadata = discovery();
    const fetchFixture = vi.fn<typeof fetch>(async (input, init) => {
      expect(init?.method ?? 'GET').toBe('GET');
      switch (String(input)) {
        case 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp': return Response.json(metadata.resourceMetadata);
        case `${issuer}/.well-known/oauth-authorization-server`: return Response.json(metadata.authorizationServerMetadata);
        default: throw new Error(`Unexpected request: ${String(input)}`);
      }
    });
    const provider = makeMcpOAuthProvider({ ...s.deps, interactive: true });
    expect(await auth(provider, { serverUrl, fetchFn: fetchFixture })).toBe('REDIRECT');
    expect(fetchFixture).toHaveBeenCalledTimes(2);
    expect(provider.saveClientInformation).toBeUndefined();
    expect(s.saved()).not.toHaveProperty('clientInformation');
  });

  it.each(['invalid_client', 'unauthorized_client'])('retains registered identity after SDK %s invalidation without DCR', async (error) => {
    const s = setup();
    await seedTokens(s);
    const fingerprint = s.saved().registeredClientFingerprint;
    const redirect = vi.fn();
    const fetchFixture = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(tokenUrl);
      expect(new URLSearchParams(String(init?.body)).get('grant_type')).toBe('refresh_token');
      return Response.json({ error }, { status: 401 });
    });
    const provider = makeMcpOAuthProvider({ ...s.deps, onRedirect: redirect });
    expect(await auth(provider, { serverUrl, fetchFn: fetchFixture })).toBe('REDIRECT');
    expect(fetchFixture).toHaveBeenCalledTimes(1);
    expect((redirect.mock.calls[0][0] as URL).searchParams.get('client_id')).toBe(clientId);
    expect(s.saved()).not.toHaveProperty('tokens');
    expect(s.saved().registeredClientFingerprint).toBe(fingerprint);
    expect(await provider.clientInformation()).toMatchObject({ client_id: clientId, client_secret: clientSecret });
    expect(provider.saveClientInformation).toBeUndefined();
  });

  it.each([
    { clientId: 'replacement-client', clientSecret },
    { clientId, clientSecret: 'replacement-secret' },
  ])('rejects saved tokens and PKCE belonging to another registered identity: $clientId / $clientSecret', async (replacement) => {
    const s = setup();
    await seedTokens(s);
    const before = s.saved();
    const changed = makeMcpOAuthProvider({ ...s.deps, registeredClient: replacement });
    const fetchFixture = vi.fn<typeof fetch>();
    await expect(auth(changed, { serverUrl, fetchFn: fetchFixture })).rejects.toBeInstanceOf(NeedsReauthError);
    await expect(changed.tokens()).rejects.toBeInstanceOf(NeedsReauthError);
    await expect(changed.codeVerifier()).rejects.toBeInstanceOf(NeedsReauthError);
    expect(fetchFixture).not.toHaveBeenCalled();
    expect(s.saved()).toEqual(before);
    expect(s.redactor.redact(replacement.clientSecret)).toBe('[redacted]');
  });

  it.each([
    { clientInformation: { client_id: 'old-dynamic-client' } },
    { tokens },
    { codeVerifier: 'old-verifier' },
    { authorizationState: 'old-authorization-state' },
  ])('does not adopt unbound existing OAuth state %j', async (initial) => {
    const s = setup(initial);
    const provider = makeMcpOAuthProvider(s.deps);
    await expect(provider.clientInformation()).rejects.toBeInstanceOf(NeedsReauthError);
    expect(s.saved()).toEqual(initial);
  });

  it('checks async registry identity on each read and remains invalid after a registry change', async () => {
    let current = client;
    const loadClient = vi.fn(async () => current);
    const s = setup({}, { registeredClient: loadClient });
    const provider = await seedTokens(s);
    current = { clientId, clientSecret: 'rotated-secret' };
    await expect(provider.tokens()).rejects.toBeInstanceOf(NeedsReauthError);
    expect(s.redactor.redact(current.clientSecret)).toBe('[redacted]');
    current = client;
    await expect(provider.clientInformation()).rejects.toBeInstanceOf(NeedsReauthError);
    expect(s.saved().tokens).toEqual(tokens);
    expect(loadClient.mock.calls.length).toBeGreaterThan(2);
  });

  it('rejects a late SDK token response if the registered secret changes during refresh', async () => {
    let current = client;
    const s = setup({}, { registeredClient: async () => current });
    await seedTokens(s);
    const before = s.saved();
    let entered!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const fetchFixture = vi.fn<typeof fetch>(async () => {
      entered(); await gate;
      return Response.json({ ...tokens, access_token: 'late-response-token' });
    });
    const provider = makeMcpOAuthProvider(s.deps);
    const pending = auth(provider, { serverUrl, fetchFn: fetchFixture });
    const rejected = expect(pending).rejects.toBeInstanceOf(NeedsReauthError);
    await waiting;
    current = { clientId, clientSecret: 'rotated-secret' };
    release();
    await rejected;
    expect(s.saved()).toEqual(before);
    expect(fetchFixture).toHaveBeenCalledTimes(1);
    await expect(provider.state!()).rejects.toBeInstanceOf(NeedsReauthError);
  });

  it('preserves a newer registered-client sign-in against stale background refresh or invalidation', async () => {
    const s = setup();
    const background = await seedTokens(s);
    await background.tokens();
    const interactive = makeMcpOAuthProvider({ ...s.deps, interactive: true });
    await interactive.state!();
    await interactive.saveCodeVerifier('new-pkce-verifier');
    const pending = s.saved();
    await expect(background.saveTokens({ ...tokens, access_token: 'old-session-refresh' })).rejects.toBeInstanceOf(NeedsReauthError);
    await expect(background.invalidateCredentials!('all')).rejects.toBeInstanceOf(NeedsReauthError);
    expect(s.saved()).toEqual(pending);
    expect(background.saveClientInformation).toBeUndefined();
  });

  it('keeps explicit discovery pinned through mutation and invalidation', async () => {
    const state = discovery();
    const s = setup({}, { discoveryState: state });
    const provider = makeMcpOAuthProvider(s.deps);
    state.authorizationServerMetadata!.token_endpoint = 'https://changed.example/token';
    const returned = await provider.discoveryState!();
    returned!.authorizationServerMetadata!.token_endpoint = 'https://returned.example/token';
    await provider.invalidateCredentials!('discovery');
    await provider.invalidateCredentials!('all');
    expect((await provider.discoveryState!())!.authorizationServerMetadata!.token_endpoint).toBe(tokenUrl);
    expect(await provider.clientInformation()).toMatchObject({ client_id: clientId });
    expect(provider.saveClientInformation).toBeUndefined();
  });

  it('invalidates saved discovery without erasing registry identity or replacing a newer sign-in', async () => {
    const s = setup({}, { discoveryState: undefined });
    const provider = await seedTokens(s);
    await provider.saveDiscoveryState!(discovery());
    expect((await provider.discoveryState!())?.authorizationServerUrl).toBe(issuer);
    await provider.tokens();
    await provider.invalidateCredentials!('discovery');
    expect(await provider.discoveryState!()).toBeUndefined();
    expect(s.saved().tokens).toEqual(tokens);
    const fingerprint = s.saved().registeredClientFingerprint;
    const interactive = makeMcpOAuthProvider({ ...s.deps, interactive: true });
    await interactive.state!();
    await interactive.saveCodeVerifier('new-pkce');
    const pending = s.saved();
    await expect(provider.saveDiscoveryState!(discovery())).rejects.toBeInstanceOf(NeedsReauthError);
    expect(s.saved()).toEqual(pending);
    expect(s.saved().registeredClientFingerprint).toBe(fingerprint);
  });

  it('requires complete override metadata so the SDK cannot silently fall back to discovery', () => {
    const s = setup();
    expect(() => makeMcpOAuthProvider({ ...s.deps, discoveryState: { authorizationServerUrl: issuer } })).toThrow('must include');
  });

  it.each(['client_id', 'client_secret', 'redirect_uri', 'state', 'scope', 'response_type', 'code', 'code_challenge', 'code_challenge_method', 'resource'])(
    'rejects authorization flags that replace %s', (key) => {
      const s = setup();
      expect(() => makeMcpOAuthProvider({ ...s.deps, authorizationParams: { [key]: 'override' } })).toThrow('cannot override');
    },
  );

  it('adds static authorization flags without mutating the SDK URL', async () => {
    const s = setup();
    const redirect = vi.fn();
    const provider = makeMcpOAuthProvider({ ...s.deps, authorizationParams: { token_access_type: 'offline' }, onRedirect: redirect });
    const original = new URL(`${issuer}/authorize?state=original-state&code_challenge=pkce`);
    await provider.redirectToAuthorization(original);
    expect(original.searchParams.has('token_access_type')).toBe(false);
    expect(Object.fromEntries((redirect.mock.calls[0][0] as URL).searchParams)).toEqual({
      state: 'original-state', code_challenge: 'pkce', token_access_type: 'offline',
    });
  });

  it('rejects an incomplete confidential registered client before contacting a server', async () => {
    const s = setup({}, { registeredClient: { clientId }, tokenEndpointAuthMethod: 'client_secret_basic' });
    const fetchFixture = vi.fn<typeof fetch>();
    await expect(auth(makeMcpOAuthProvider(s.deps), { serverUrl, fetchFn: fetchFixture })).rejects.toBeInstanceOf(NeedsReauthError);
    expect(fetchFixture).not.toHaveBeenCalled();
  });

  it('persists only the registered-client fingerprint inside sealed MCP state', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-registered-'));
    try {
      const store = mcpServerStore({ dir, secretBox: aesGcmSecretBox({ key: generateSecretKey() }), lock: fileLock({ dir: path.join(dir, 'locks') }) });
      const entry = await store.create({ slug: 'registered', displayName: 'Registered', url: serverUrl, auth: { kind: 'oauth' } });
      const s = setup({}, {
        load: async () => await store.getOAuthState(entry.id) as McpOAuthState ?? {},
        compareAndSave: async (revision, state) => store.compareAndSetOAuthState(entry.id, revision,
          state as unknown as Record<string, unknown>) as Promise<McpOAuthState | null>,
      });
      await seedTokens(s);
      const saved = await store.getOAuthState(entry.id) as McpOAuthState;
      expect(saved.registeredClientFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(saved).not.toHaveProperty('clientInformation');
      expect(JSON.stringify(saved)).not.toContain(clientSecret);
      const disk = fs.readFileSync(path.join(dir, 'mcp-servers.json'), 'utf8');
      expect(JSON.parse(disk)[0]).toHaveProperty('sealedOAuth');
      for (const sensitive of [clientSecret, tokens.access_token, tokens.refresh_token, saved.registeredClientFingerprint!]) {
        expect(disk).not.toContain(sensitive);
        expect(JSON.stringify(store.list())).not.toContain(sensitive);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
