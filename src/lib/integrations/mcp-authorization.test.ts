import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationError } from '@integrations/engine';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { beginMcpAuthorization, completeMcpAuthorization } from './mcp-authorization';
import { makeMcpOAuthProvider, type McpOAuthProviderDeps, type McpOAuthState } from './mcp-oauth';
import type { McpServerEntry } from './mcp-servers';

const mocks = vi.hoisted(() => ({
  consumeOAuthState: vi.fn(),
  get: vi.fn(),
  completeAuthorization: vi.fn(),
  finalizeMcpServer: vi.fn(),
  getToolkits: vi.fn(),
  clientInformation: vi.fn(),
  finishMcpOAuth: vi.fn(),
  beginMcpOAuth: vi.fn(),
  connectMcpClient: vi.fn(),
  mcpOAuthProviderFor: vi.fn(),
  invalidateIntegrationRuntime: vi.fn(),
}));

vi.mock('@integrations/engine/mcp', () => ({ beginMcpOAuth: mocks.beginMcpOAuth, finishMcpOAuth: mocks.finishMcpOAuth, connectMcpClient: mocks.connectMcpClient }));
vi.mock('./mcp-lifecycle', () => ({ finalizeMcpServer: mocks.finalizeMcpServer }));
vi.mock('./runtime', () => ({
  getMcpServerStore: () => ({ consumeOAuthState: mocks.consumeOAuthState, get: mocks.get, completeAuthorization: mocks.completeAuthorization }),
  getIntegrationRuntime: async () => ({ getToolkits: mocks.getToolkits }),
  invalidateIntegrationRuntime: mocks.invalidateIntegrationRuntime,
  mcpOAuthProviderFor: mocks.mcpOAuthProviderFor,
  MCP_TIMEOUT_MS: 10_000,
  withTimeout: (promise: Promise<unknown>) => promise,
}));

const entry: McpServerEntry = {
  id: 'todoist-server', providerId: 'todoist', slug: 'builtin_todoist', displayName: 'Todoist',
  url: 'https://ai.todoist.net/mcp', enabled: true, auth: { kind: 'oauth' }, createdAt: 'then', updatedAt: 'then',
};

describe('MCP authorization completion', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.consumeOAuthState.mockResolvedValue(true);
    mocks.get.mockReturnValue({ ...entry, lastStatus: 'ok' });
    mocks.getToolkits.mockReturnValue([{ id: 'todoist' }]);
    mocks.mcpOAuthProviderFor.mockReturnValue({ clientInformation: mocks.clientInformation });
    mocks.finalizeMcpServer.mockImplementation(async (saved, _store, callback) => callback(saved));
    mocks.completeAuthorization.mockResolvedValue(true);
  });

  it('finishes only when state is consumed and the authorized integration discovers tools', async () => {
    await completeMcpAuthorization(entry, 'code', 'state');
    expect(mocks.consumeOAuthState).toHaveBeenCalledWith(entry.id, 'state');
    expect(mocks.finishMcpOAuth).toHaveBeenCalledOnce();
    expect(mocks.invalidateIntegrationRuntime).toHaveBeenCalledOnce();
    expect(mocks.completeAuthorization).toHaveBeenCalledWith(entry.id, createHash('sha256').update('state').digest('hex'));
  });

  it('rejects expired or replayed state without exchanging the authorization code', async () => {
    mocks.consumeOAuthState.mockResolvedValue(false);
    await expect(completeMcpAuthorization(entry, 'code', 'state')).rejects.toThrow('Invalid or expired');
    expect(mocks.finishMcpOAuth).not.toHaveBeenCalled();
  });

  it.each(['unreachable', 'missing toolkit'])('does not report a failed integration as connected: %s', async (failure) => {
    if (failure === 'unreachable') mocks.get.mockReturnValue({ ...entry, lastStatus: 'unreachable' });
    else mocks.getToolkits.mockReturnValue([]);
    await expect(completeMcpAuthorization(entry, 'code', 'state')).rejects.toThrow('could not load its tools');
    expect(mocks.completeAuthorization).not.toHaveBeenCalled();
  });

  it('does not record a completed consent after its account changes during discovery', async () => {
    mocks.finalizeMcpServer.mockResolvedValue(null);
    await expect(completeMcpAuthorization(entry, 'code', 'state')).rejects.toThrow('connection changed');
    expect(mocks.completeAuthorization).not.toHaveBeenCalled();
  });

  it('rejects a consumed consent superseded by another flow during discovery', async () => {
    mocks.completeAuthorization.mockResolvedValue(false);
    await expect(completeMcpAuthorization(entry, 'code', 'state')).rejects.toThrow('connection changed');
    expect(mocks.completeAuthorization).toHaveBeenCalledWith(entry.id, createHash('sha256').update('state').digest('hex'));
  });

  it('allows authorization of a deliberately disabled custom server without exposing tools', async () => {
    const disabled = { ...entry, providerId: undefined, slug: 'custom', enabled: false };
    mocks.get.mockReturnValue(disabled);
    mocks.getToolkits.mockReturnValue([]);
    await expect(completeMcpAuthorization(disabled, 'code', 'state')).resolves.toBeUndefined();
  });
});

describe('MCP interactive authorization secret confinement', () => {
  const clientId = 'fixture-registered-client';
  const clientSecret = 'fixture-registered-secret';
  const basic = Buffer.from(`${clientId}:${clientSecret}`, 'latin1').toString('base64');
  const accessToken = 'fixture-access-token';
  const refreshToken = 'fixture-refresh-token';
  const verifier = 'fixture-pkce-verifier';

  beforeEach(() => {
    vi.resetAllMocks();
    let saved: McpOAuthState = {};
    let revision = 0;
    mocks.mcpOAuthProviderFor.mockImplementation((_entry: McpServerEntry, onRedirect?: McpOAuthProviderDeps['onRedirect'], options?: Partial<McpOAuthProviderDeps>) =>
      makeMcpOAuthProvider({
        redirectUrl: 'https://app.example/callback', clientName: 'Fixture',
        registeredClient: { clientId, clientSecret }, tokenEndpointAuthMethod: 'client_secret_basic',
        load: async () => structuredClone(saved),
        compareAndSave: async (expected, state) => {
          if (expected !== saved.revision) return null;
          saved = structuredClone({ ...state, revision: String(++revision) });
          return structuredClone(saved);
        },
        onRedirect, ...options,
      }),
    );
  });

  it('starts Docusign consent from metadata without contacting its unchallenged transport', async () => {
    mocks.beginMcpOAuth.mockImplementation(async ({ authProvider }: { authProvider: OAuthClientProvider }) => {
      await authProvider.clientInformation();
      const state = await authProvider.state!();
      await authProvider.saveCodeVerifier(verifier);
      await authProvider.redirectToAuthorization(new URL(`https://account.docusign.com/oauth/auth?state=${state}`));
      return 'REDIRECT';
    });
    const docusign = { ...entry, providerId: 'docusign', slug: 'builtin_docusign', url: 'https://mcp.docusign.com/mcp' };
    await expect(beginMcpAuthorization(docusign)).resolves.toMatchObject({
      requiresAuth: true, authUrl: expect.stringContaining('https://account.docusign.com/oauth/auth?state='),
      authorizationId: expect.any(String),
    });
    expect(mocks.beginMcpOAuth).toHaveBeenCalledWith({ url: docusign.url, authProvider: expect.any(Object) });
    expect(mocks.connectMcpClient).not.toHaveBeenCalled();
  });

  it('redacts a failed preauthorization and does not retry it against the transport', async () => {
    mocks.beginMcpOAuth.mockImplementation(async ({ authProvider }: { authProvider: OAuthClientProvider }) => {
      await authProvider.clientInformation();
      throw new Error(`Denied Basic ${basic} secret=${clientSecret}`);
    });
    const docusign = { ...entry, providerId: 'docusign', slug: 'builtin_docusign', url: 'https://mcp.docusign.com/mcp' };
    const error = await beginMcpAuthorization(docusign).catch(error => error as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(basic);
    expect((error as Error).message).not.toContain(clientSecret);
    expect(mocks.connectMcpClient).not.toHaveBeenCalled();
  });

  it('starts WordPress consent with only the trusted catalog scope even when the request asks for more', async () => {
    mocks.beginMcpOAuth.mockImplementation(async ({ authProvider, scope }: { authProvider: OAuthClientProvider; scope?: string }) => {
      const state = await authProvider.state!();
      await authProvider.saveCodeVerifier(verifier);
      const consent = new URL('https://public-api.wordpress.com/oauth2-1/authorize');
      consent.searchParams.set('state', state);
      consent.searchParams.set('scope', scope!);
      await authProvider.redirectToAuthorization(consent);
      return 'REDIRECT';
    });
    const wordpress = { ...entry, providerId: 'wordpress', slug: 'builtin_wordpress', url: 'https://public-api.wordpress.com/wpcom/v2/mcp/v1' };
    const result = await beginMcpAuthorization(wordpress, new Request('https://app.example/connect?scope=global'));
    expect(result).toMatchObject({ requiresAuth: true });
    if (!result.requiresAuth) throw new Error('Expected consent');
    expect(new URL(result.authUrl).searchParams.get('scope')).toBe('auth');
    expect(mocks.beginMcpOAuth).toHaveBeenCalledWith({ url: wordpress.url, authProvider: expect.any(Object), scope: 'auth' });
    expect(mocks.connectMcpClient).not.toHaveBeenCalled();
  });

  it('does not reinterpret an arbitrary custom server 403 as a reason to preauthorize', async () => {
    mocks.connectMcpClient.mockRejectedValue(new Error('HTTP 403 forbidden'));
    const custom = { ...entry, providerId: undefined, slug: 'custom', url: 'https://custom.example/mcp' };
    await expect(beginMcpAuthorization(custom)).rejects.toThrow('403 forbidden');
    expect(mocks.beginMcpOAuth).not.toHaveBeenCalled();
  });

  it.each(['SDK Error', 'IntegrationError', 'string'])('redacts reflected Basic and raw secrets from an interactive %s', async (kind) => {
    const rawMessage = `Upstream rejected Authorization: Basic ${basic}; secret=${clientSecret}; access=${accessToken}; refresh=${refreshToken}; verifier=${verifier}`;
    const failure = kind === 'IntegrationError'
      ? new IntegrationError('provider_unavailable', rawMessage, { status: 503, retryAfter: 10, cause: { response: rawMessage } })
      : kind === 'string' ? rawMessage : new Error(rawMessage, { cause: { response: rawMessage } });
    mocks.connectMcpClient.mockImplementation(async ({ authProvider }: { authProvider: OAuthClientProvider }) => {
      // Exercise the real provider's registry load and persistence callbacks,
      // then simulate an SDK error carrying a reflected upstream response.
      await authProvider.clientInformation();
      await authProvider.saveTokens({ access_token: accessToken, refresh_token: refreshToken, token_type: 'Bearer' });
      await authProvider.saveCodeVerifier(verifier);
      throw failure;
    });
    const surfaced = await beginMcpAuthorization(entry).catch(error => error as Error);
    expect(surfaced).toBeInstanceOf(Error);
    if (!(surfaced instanceof Error)) throw new Error('Expected authorization to fail');
    expect(surfaced).not.toBe(failure);
    expect(surfaced.message).toContain('Upstream rejected Authorization: Basic [redacted:client_credentials]');
    expect(surfaced.message).toContain('secret=[redacted:client_secret]');
    expect(surfaced.message).toContain('access=[redacted:access_token]');
    expect(surfaced.message).toContain('refresh=[redacted:refresh_token]');
    expect(surfaced.message).toContain('verifier=[redacted:pkce_verifier]');
    expect(surfaced.cause).toBeUndefined();
    for (const secret of [clientSecret, basic, accessToken, refreshToken, verifier]) {
      expect(surfaced.stack).not.toContain(secret);
      expect(JSON.stringify(surfaced)).not.toContain(secret);
    }
    if (kind === 'IntegrationError') expect(surfaced).toMatchObject({ code: 'provider_unavailable', status: 503, retryAfter: 10 });
  });

  it('keeps a valid consent redirect when the transport raises its expected authentication signal', async () => {
    mocks.connectMcpClient.mockImplementation(async ({ authProvider }: { authProvider: OAuthClientProvider }) => {
      await authProvider.clientInformation();
      const state = await authProvider.state!();
      await authProvider.saveCodeVerifier(verifier);
      await authProvider.redirectToAuthorization(new URL(`https://oauth.example/authorize?state=${state}`));
      throw new Error('Unauthorized');
    });
    const result = await beginMcpAuthorization(entry);
    expect(result).toMatchObject({ requiresAuth: true, authUrl: expect.stringContaining('https://oauth.example/authorize?state=') });
    if (!result.requiresAuth) throw new Error('Expected consent');
    const state = new URL(result.authUrl).searchParams.get('state')!;
    expect(result.authorizationId).toBe(createHash('sha256').update(state).digest('hex'));
    expect(result.authorizationId).not.toBe(state);
  });
});
import { createHash } from 'node:crypto';
