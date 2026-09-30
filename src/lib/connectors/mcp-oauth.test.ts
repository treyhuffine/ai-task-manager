import { describe, expect, it, vi } from 'vitest';
import { createRedactor, NeedsReauthError } from '@connectors/engine';
import { getHostedMcpProvider } from '@connectors/engine/providers';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { makeMcpOAuthProvider, type McpOAuthState } from './mcp-oauth';

function setup(initial: McpOAuthState = {}) {
  let saved = structuredClone(initial);
  let revision = 0;
  const replace = async (value: McpOAuthState) => { saved = structuredClone({ ...value, revision: String(++revision) }); };
  const redactor = createRedactor();
  const deps = {
    redirectUrl: 'http://127.0.0.1:4224/api/connectors/mcp-oauth/example',
    clientName: 'Test client',
    load: async () => structuredClone(saved),
    compareAndSave: async (expectedRevision: string | undefined, value: McpOAuthState): Promise<McpOAuthState | null> => {
      if (saved.revision !== expectedRevision) return null;
      await replace(value);
      return structuredClone(saved);
    },
    onState: (state: McpOAuthState) => {
      if (state.tokens?.access_token) redactor.register(state.tokens.access_token);
      if (state.tokens?.refresh_token) redactor.register(state.tokens.refresh_token);
    },
  };
  return { provider: makeMcpOAuthProvider(deps), deps, saved: () => saved, replace, redactor };
}

describe('MCP OAuth provider', () => {
  it('requires interactive preauthorization before registering or creating new consent state', async () => {
    const s = setup();
    const provider = makeMcpOAuthProvider({ ...s.deps, requireInteractiveAuthorization: true });
    await expect(provider.clientInformation()).rejects.toBeInstanceOf(NeedsReauthError);
    await expect(provider.state!()).rejects.toBeInstanceOf(NeedsReauthError);
    expect(s.saved()).toEqual({});

    const interactive = makeMcpOAuthProvider({ ...s.deps, requireInteractiveAuthorization: true, interactive: true });
    expect(await interactive.clientInformation()).toBeUndefined();
    await interactive.saveClientInformation!({ client_id: 'fixture-client' });
    await expect(interactive.state!()).resolves.toEqual(expect.any(String));
    const callback = makeMcpOAuthProvider({ ...s.deps, requireInteractiveAuthorization: true });
    await expect(callback.clientInformation()).resolves.toEqual({ client_id: 'fixture-client' });
  });

  it.each([
    {
      id: 'clickup', issuer: 'https://mcp.clickup.com',
      resourceMetadataUrl: 'https://mcp.clickup.com/.well-known/oauth-protected-resource/mcp',
      authorizationEndpoint: 'https://mcp.clickup.com/oauth/authorize',
      tokenEndpoint: 'https://mcp.clickup.com/oauth/token', registrationEndpoint: 'https://mcp.clickup.com/oauth/register',
      scopes: ['read', 'write'],
    },
    {
      id: 'ticktick', issuer: 'https://ticktick.com',
      resourceMetadataUrl: 'https://mcp.ticktick.com/.well-known/oauth-protected-resource',
      authorizationEndpoint: 'https://ticktick.com/oauth/authorize',
      tokenEndpoint: 'https://api.ticktick.com/oauth/token', registrationEndpoint: 'https://api.ticktick.com/oauth/register',
      scopes: ['tasks:write', 'tasks:read'],
    },
  ])('registers $id through the SDK without requesting its unsupported refresh grant', async (profile) => {
    const definition = getHostedMcpProvider(profile.id)!;
    if (definition.auth?.kind !== 'oauth') throw new Error('Expected catalog OAuth profile');
    const s = setup();
    const redirects = vi.fn();
    const provider = makeMcpOAuthProvider({ ...s.deps, interactive: true,
      grantTypes: definition.auth.grantTypes, tokenEndpointAuthMethod: definition.auth.tokenEndpointAuthMethod,
      onRedirect: redirects,
    });
    const registrations: Record<string, unknown>[] = [];
    const fetchFixture = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url === profile.resourceMetadataUrl) {
        return Response.json({ resource: definition.url, authorization_servers: [profile.issuer], scopes_supported: profile.scopes });
      }
      if (method === 'GET' && url === `${profile.issuer}/.well-known/oauth-authorization-server`) {
        return Response.json({
          issuer: profile.issuer, authorization_endpoint: profile.authorizationEndpoint,
          token_endpoint: profile.tokenEndpoint, registration_endpoint: profile.registrationEndpoint,
          response_types_supported: ['code'], grant_types_supported: ['authorization_code'],
          code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
        });
      }
      if (method === 'POST' && url === profile.registrationEndpoint) {
        const body = JSON.parse(String(init?.body));
        registrations.push(body);
        if (body.grant_types.some((grant: string) => grant !== 'authorization_code')) {
          return Response.json({ error: 'invalid_client_metadata', error_description: 'Unsupported grant type' }, { status: 400 });
        }
        return Response.json({ ...body, client_id: `${profile.id}-fixture-client` });
      }
      throw new Error(`Unexpected fixture request: ${method} ${url}`);
    });
    expect(await auth(provider, { serverUrl: definition.url!, fetchFn: fetchFixture })).toBe('REDIRECT');
    expect(registrations).toEqual([expect.objectContaining({ grant_types: ['authorization_code'], token_endpoint_auth_method: 'none', scope: profile.scopes.join(' ') })]);
    expect(s.saved().clientInformation).toMatchObject({ client_id: `${profile.id}-fixture-client`, grant_types: ['authorization_code'] });
    const target = redirects.mock.calls[0]![0] as URL;
    expect(target.searchParams.get('code_challenge_method')).toBe('S256');
    expect(target.searchParams.get('scope')).toBe(profile.scopes.join(' '));
    expect(target.searchParams.get('response_type')).toBe('code');
    expect(fetchFixture.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('uses public-client authorization code and refresh grants compatible with Todoist DCR', () => {
    const { provider } = setup();
    expect(provider.clientMetadata).toMatchObject({
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
    });
  });

  it('observes tokens changed by another provider and registers both old and refreshed secrets', async () => {
    const { provider, replace, redactor } = setup({ tokens: { access_token: 'initial-access-token', token_type: 'Bearer' } });
    await provider.tokens();
    await replace({ tokens: { access_token: 'externally-refreshed-token', token_type: 'Bearer' } });
    expect(await provider.tokens()).toMatchObject({ access_token: 'externally-refreshed-token' });
    await provider.saveTokens({ access_token: 'new-access-token', refresh_token: 'new-refresh-token', token_type: 'Bearer' });
    expect(redactor.redact('initial-access-token externally-refreshed-token new-access-token new-refresh-token')).toBe(
      '[redacted] [redacted] [redacted] [redacted]',
    );
  });

  it('preserves a newer interactive sign-in when a background session refreshes tokens', async () => {
    const s = setup({ tokens: { access_token: 'old-access-token', token_type: 'Bearer' } });
    await s.provider.tokens(); // Populate the background provider before sign-in starts elsewhere.
    const interactive = makeMcpOAuthProvider({ ...s.deps, interactive: true });
    const pending = await interactive.state!();
    await interactive.saveCodeVerifier('new-sign-in-verifier');
    await expect(s.provider.saveTokens({ access_token: 'refreshed-access-token', token_type: 'Bearer' })).rejects.toThrow('authorization changed');
    expect(s.saved()).toMatchObject({ authorizationState: pending, codeVerifier: 'new-sign-in-verifier' });
    expect(s.saved().tokens?.access_token).toBe('old-access-token');
    // The SDK can fall back to authorization after a rejected refresh. That
    // old provider must not replace the newer flow's state or registration.
    await expect(s.provider.state!()).rejects.toThrow('authorization changed');
    await expect(s.provider.saveClientInformation!({ client_id: 'old-client' })).rejects.toThrow('authorization changed');
  });

  it('clears the verifier after an atomically consumed sign-in finishes exchanging tokens', async () => {
    const s = setup({ codeVerifier: 'consumed-sign-in-verifier', redirectUri: 'https://saved.example/callback' });
    await s.provider.clientInformation();
    expect(s.provider.redirectUrl).toBe('https://saved.example/callback');
    await s.provider.saveTokens({ access_token: 'authorized-access-token', token_type: 'Bearer' });
    expect(s.saved()).not.toHaveProperty('codeVerifier');
    expect(s.saved()).not.toHaveProperty('authorizationState');
  });

  it('allows a reused desktop provider to exchange code after callback state consumption', async () => {
    const s = setup({ clientInformation: { client_id: 'client' } });
    const provider = makeMcpOAuthProvider({ ...s.deps, interactive: true, callbackChannel: 'desktop' });
    await provider.clientInformation();
    await provider.tokens();
    await provider.state!();
    await provider.saveCodeVerifier('desktop-verifier');
    const consumed = { ...s.saved() };
    delete consumed.authorizationState;
    delete consumed.authorizationExpiresAt;
    await s.replace(consumed);
    await provider.clientInformation(); // completeMcpAuthorization primes redirect URL.
    expect(await provider.codeVerifier()).toBe('desktop-verifier');
    await provider.clientInformation(); // SDK fetchToken reads client info after verifier.
    await provider.saveTokens({ access_token: 'desktop-token', token_type: 'Bearer' });
    expect(s.saved()).toMatchObject({ callbackChannel: 'desktop', tokens: { access_token: 'desktop-token' } });
    expect(s.saved()).not.toHaveProperty('codeVerifier');
  });

  it.each(['refresh', 'invalidate tokens', 'invalidate all'])('rejects deferred old %s after a new login completes', async (operation) => {
    const s = setup({ sessionId: 'original', clientInformation: { client_id: 'old-client' },
      tokens: { access_token: 'old-access', refresh_token: 'old-refresh', token_type: 'Bearer' } });
    await s.provider.clientInformation();
    await s.provider.tokens();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const late = gate.then(() => operation === 'refresh'
      ? s.provider.saveTokens({ access_token: 'late-old-access', token_type: 'Bearer' })
      : s.provider.invalidateCredentials!(operation === 'invalidate all' ? 'all' : 'tokens'));
    const rejected = expect(late).rejects.toThrow('authorization changed');
    const fresh = makeMcpOAuthProvider({ ...s.deps, interactive: true });
    await fresh.clientInformation();
    await fresh.tokens();
    await fresh.state!();
    await fresh.saveCodeVerifier('new-verifier');
    const consumed = { ...s.saved() };
    delete consumed.authorizationState;
    delete consumed.authorizationExpiresAt;
    await s.replace(consumed);
    await fresh.codeVerifier();
    await fresh.clientInformation();
    await fresh.saveTokens({ access_token: 'new-login-access', refresh_token: 'new-login-refresh', token_type: 'Bearer' });
    const completed = structuredClone(s.saved());
    release();
    await rejected;
    expect(s.saved()).toEqual(completed);
    // Reloading a newer session must not rebind the old provider and permit a later stale write.
    await expect(s.provider.tokens()).rejects.toThrow('authorization changed');
  });

  it('checks revisions atomically when another writer wins during save', async () => {
    const s = setup({ tokens: { access_token: 'old', token_type: 'Bearer' } });
    const original = s.deps.compareAndSave;
    let resume!: () => void;
    let entered!: () => void;
    const enteredSave = new Promise<void>((resolve) => { entered = resolve; });
    const wait = new Promise<void>((resolve) => { resume = resolve; });
    const provider = makeMcpOAuthProvider({ ...s.deps, compareAndSave: async (revision, state) => {
      entered(); await wait;
      return original(revision, state);
    } });
    await provider.tokens();
    const saving = provider.saveTokens({ access_token: 'stale', token_type: 'Bearer' });
    const rejected = expect(saving).rejects.toThrow('authorization changed');
    await enteredSave;
    await s.replace({ sessionId: 'new-login', tokens: { access_token: 'winner', token_type: 'Bearer' } });
    resume(); await rejected;
    expect(s.saved().tokens?.access_token).toBe('winner');
  });
});
