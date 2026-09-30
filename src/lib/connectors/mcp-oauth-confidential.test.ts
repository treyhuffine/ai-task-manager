import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { createRedactor, fileLock } from '@connectors/engine';
import { aesGcmSecretBox, generateSecretKey } from '@connectors/engine/crypto';
import { getHostedMcpProvider } from '@connectors/engine/providers';
import { describe, expect, it, vi } from 'vitest';
import { makeMcpOAuthProvider, type McpOAuthProviderDeps, type McpOAuthState } from './mcp-oauth';
import { mcpServerStore } from './mcp-servers';

const profiles = [
  {
    id: 'reclaim', url: 'https://mcp.reclaim.ai/', resource: 'https://mcp.reclaim.ai',
    resourceMetadataUrl: 'https://mcp.reclaim.ai/.well-known/oauth-protected-resource',
    issuer: 'https://mcp.reclaim.ai', metadataUrl: 'https://mcp.reclaim.ai/.well-known/oauth-authorization-server',
    authorizeUrl: 'https://api.app.reclaim.ai/oauth2/authorize', tokenUrl: 'https://api.app.reclaim.ai/oauth2/token',
    registerUrl: 'https://api.app.reclaim.ai/oauth2/register', methods: ['client_secret_post', 'client_secret_basic'],
    scopes: ['read', 'write', 'mcp'],
  },
  {
    id: 'miro', url: 'https://mcp.miro.com/', resource: 'https://mcp.miro.com/',
    resourceMetadataUrl: 'https://mcp.miro.com/.well-known/oauth-protected-resource',
    issuer: 'https://mcp.miro.com/', metadataUrl: 'https://mcp.miro.com/.well-known/oauth-authorization-server',
    authorizeUrl: 'https://mcp.miro.com/authorize', tokenUrl: 'https://mcp.miro.com/token',
    registerUrl: 'https://mcp.miro.com/register', methods: ['client_secret_post', 'client_secret_basic'],
    scopes: ['boards:read', 'boards:write', 'openid', 'email'],
  },
  {
    id: 'make', url: 'https://mcp.make.com', resource: 'https://mcp.make.com/',
    resourceMetadataUrl: 'https://mcp.make.com/.well-known/oauth-protected-resource',
    issuer: 'https://www.make.com/mcp', metadataUrl: 'https://www.make.com/.well-known/oauth-authorization-server/mcp',
    authorizeUrl: 'https://www.make.com/oauth/v2/authorize', tokenUrl: 'https://www.make.com/oauth/v2/token',
    registerUrl: 'https://www.make.com/oauth/v2/register/mcp', methods: ['client_secret_post'], scopes: undefined,
  },
  {
    id: 'supabase', url: 'https://mcp.supabase.com/mcp', resource: 'https://mcp.supabase.com/mcp',
    resourceMetadataUrl: 'https://mcp.supabase.com/.well-known/oauth-protected-resource/mcp',
    issuer: 'https://api.supabase.com', metadataUrl: 'https://api.supabase.com/.well-known/oauth-authorization-server',
    authorizeUrl: 'https://api.supabase.com/v1/oauth/authorize', tokenUrl: 'https://api.supabase.com/v1/oauth/token',
    registerUrl: 'https://api.supabase.com/platform/oauth/apps/register', methods: ['client_secret_basic', 'client_secret_post'],
    scopes: ['organizations:read', 'projects:read', 'projects:write', 'database:write', 'database:read', 'analytics:read',
      'secrets:read', 'edge_functions:read', 'edge_functions:write', 'environment:read', 'environment:write', 'storage:read', 'storage:write'],
  },
];

describe('hosted MCP confidential dynamic registration', () => {
  it.each(profiles)('keeps $id DCR credentials sealed and uses client_secret_post for code exchange and refresh', async (profile) => {
    // All HTTP is intercepted. These endpoint/metadata fixtures were observed
    // using public GET discovery, without registering a client with a service.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-confidential-'));
    try {
      const secretBox = aesGcmSecretBox({ key: generateSecretKey() });
      const store = mcpServerStore({ dir, secretBox, lock: fileLock({ dir: path.join(dir, 'locks') }) });
      const entry = await store.create({ slug: profile.id, displayName: profile.id, url: profile.url, auth: { kind: 'oauth' } });
      const redactor = createRedactor();
      const definition = getHostedMcpProvider(profile.id);
      expect(definition?.url).toBe(profile.url);
      expect(definition?.auth?.kind).toBe('oauth');
      if (definition?.auth?.kind !== 'oauth') throw new Error('Expected catalog OAuth profile');
      expect(definition.auth.tokenEndpointAuthMethod).toBe('client_secret_post');
      const deps: McpOAuthProviderDeps = {
        redirectUrl: 'https://app.example/mcp/callback', clientName: 'Connector fixture',
        tokenEndpointAuthMethod: definition.auth.tokenEndpointAuthMethod,
        load: async () => await store.getOAuthState(entry.id) as McpOAuthState ?? {},
        compareAndSave: async (revision, state) => store.compareAndSetOAuthState(entry.id, revision,
          state as unknown as Record<string, unknown>) as Promise<McpOAuthState | null>,
        onState: (state) => {
          const client = state.clientInformation;
          if (client && 'client_secret' in client && typeof client.client_secret === 'string') redactor.register(client.client_secret);
          if (state.tokens?.access_token) redactor.register(state.tokens.access_token);
          if (state.tokens?.refresh_token) redactor.register(state.tokens.refresh_token);
          if (state.codeVerifier) redactor.register(state.codeVerifier);
        },
      };
      const { registerUrl, tokenUrl } = profile;
      const clientId = `fixture-${profile.id}-client`;
      const clientSecret = `fixture-${profile.id}-client-secret`;
      const registrationBodies: Record<string, unknown>[] = [];
      const tokenBodies: URLSearchParams[] = [];
      const tokenHeaders: Headers[] = [];
      const fetchFixture = vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (url === registerUrl && method === 'POST') {
          const body = JSON.parse(String(init?.body));
          registrationBodies.push(body);
          return Response.json({ ...body, client_id: clientId, client_secret: clientSecret });
        }
        if (url === tokenUrl && method === 'POST') {
          tokenBodies.push(new URLSearchParams(String(init?.body)));
          tokenHeaders.push(new Headers(init?.headers));
          return Response.json({ access_token: `fixture-access-${tokenBodies.length}`, refresh_token: `fixture-refresh-${tokenBodies.length}`, token_type: 'Bearer' });
        }
        if (method === 'GET' && url === profile.resourceMetadataUrl) {
          return Response.json({ resource: profile.resource, authorization_servers: [profile.issuer], bearer_methods_supported: ['header'],
            ...(profile.scopes ? { scopes_supported: profile.scopes } : {}),
          });
        }
        if (method === 'GET' && url === profile.metadataUrl) {
          return Response.json({
            issuer: profile.issuer, authorization_endpoint: profile.authorizeUrl,
            token_endpoint: tokenUrl, registration_endpoint: registerUrl,
            response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
            token_endpoint_auth_methods_supported: profile.methods, code_challenge_methods_supported: ['S256'],
            ...(profile.scopes ? { scopes_supported: profile.scopes } : {}),
          });
        }
        throw new Error(`Unexpected fixture request: ${method} ${url}`);
      });
      const assertSealed = (...secrets: string[]) => {
        const disk = fs.readFileSync(path.join(dir, 'mcp-servers.json'), 'utf8');
        const publicMetadata = JSON.stringify(store.list());
        expect(JSON.parse(disk)[0]).toHaveProperty('sealedOAuth');
        for (const secret of secrets) {
          expect(disk).not.toContain(secret);
          expect(publicMetadata).not.toContain(secret);
          expect(redactor.redact(secret)).toBe('[redacted]');
        }
      };

      const redirect = vi.fn();
      const interactive = makeMcpOAuthProvider({ ...deps, interactive: true, onRedirect: redirect });
      expect(await auth(interactive, { serverUrl: entry.url, fetchFn: fetchFixture })).toBe('REDIRECT');
      expect(registrationBodies).toEqual([{
        client_name: 'Connector fixture', redirect_uris: [deps.redirectUrl],
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'client_secret_post',
        ...(profile.scopes ? { scope: profile.scopes.join(' ') } : {}),
      }]);
      const pending = await deps.load();
      expect(pending.clientInformation).toMatchObject({ client_secret: clientSecret });
      const consentUrl = redirect.mock.calls[0][0] as URL;
      expect(consentUrl.href).not.toContain(clientSecret);
      expect(consentUrl.searchParams.get('client_id')).toBe(clientId);
      expect(consentUrl.searchParams.get('scope')).toBe(profile.scopes?.join(' ') ?? null);
      expect(consentUrl.searchParams.get('code_challenge_method')).toBe('S256');
      assertSealed(clientSecret, pending.codeVerifier!);

      expect(await store.consumeOAuthState(entry.id, pending.authorizationState!)).toBe(true);
      const callback = makeMcpOAuthProvider(deps);
      expect(await auth(callback, { serverUrl: entry.url, authorizationCode: 'fixture-code', fetchFn: fetchFixture })).toBe('AUTHORIZED');
      expect(Object.fromEntries(tokenBodies[0])).toMatchObject({
        grant_type: 'authorization_code', code: 'fixture-code', code_verifier: pending.codeVerifier,
        client_id: clientId, client_secret: clientSecret, redirect_uri: deps.redirectUrl,
      });
      expect(tokenHeaders[0].has('Authorization')).toBe(false);
      assertSealed(clientSecret, 'fixture-access-1', 'fixture-refresh-1');

      const background = makeMcpOAuthProvider(deps);
      expect(await auth(background, { serverUrl: entry.url, fetchFn: fetchFixture })).toBe('AUTHORIZED');
      expect(Object.fromEntries(tokenBodies[1])).toMatchObject({
        grant_type: 'refresh_token', refresh_token: 'fixture-refresh-1', client_id: clientId, client_secret: clientSecret,
      });
      expect(tokenHeaders[1].has('Authorization')).toBe(false);
      expect(registrationBodies).toHaveLength(1);
      expect((await deps.load()).tokens).toMatchObject({ access_token: 'fixture-access-2', refresh_token: 'fixture-refresh-2' });
      assertSealed(clientSecret, 'fixture-access-2', 'fixture-refresh-2');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
