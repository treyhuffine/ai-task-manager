import { createHash } from 'node:crypto';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { getHostedMcpProvider } from '@connectors/engine/providers';
import { describe, expect, it, vi } from 'vitest';
import capture from '../../../docs/connector-audit/sixth-wave-discovery.json';
import { makeMcpOAuthProvider, type McpOAuthProviderDeps, type McpOAuthState } from './mcp-oauth';

describe('PostHog hosted OAuth', () => {
  it('uses the advertised resource scopes and preserves the unified regional issuer through code exchange and refresh', async () => {
    const definition = getHostedMcpProvider('posthog')!;
    expect(definition).toMatchObject({ url: 'https://mcp.posthog.com/mcp', defaultMutationRisk: 'high' });
    const observed = capture.records.find(record => record.id === 'posthog')!;
    const { resourceMetadata, authorizationServerMetadata } = observed.discovery;
    const resource = resourceMetadata.resource;
    const resourceMetadataUrl = 'https://mcp.posthog.com/.well-known/oauth-protected-resource/mcp';
    const serverMetadataUrl = 'https://oauth.posthog.com/.well-known/oauth-authorization-server';
    const requestedScopes = resourceMetadata.scopes_supported.join(' ');
    let saved: McpOAuthState = {};
    let revision = 0;
    const deps: McpOAuthProviderDeps = {
      redirectUrl: 'http://127.0.0.1:45123/mcp/callback', clientName: 'PostHog fixture',
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
      if (url === resourceMetadataUrl && method === 'GET') return Response.json(resourceMetadata);
      if (url === serverMetadataUrl && method === 'GET') return Response.json(authorizationServerMetadata);
      if (url === authorizationServerMetadata.registration_endpoint && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        registrations.push(body);
        return Response.json({ ...body, client_id: 'fixture-posthog-client' });
      }
      if (url === authorizationServerMetadata.token_endpoint && method === 'POST') {
        const body = new URLSearchParams(String(init?.body));
        expect(body.has('client_secret')).toBe(false);
        expect(new Headers(init?.headers).has('Authorization')).toBe(false);
        exchanges.push(body);
        return Response.json({ access_token: `fixture-access-${exchanges.length}`, token_type: 'Bearer',
          refresh_token: `fixture-refresh-${exchanges.length}`, scope: requestedScopes });
      }
      throw new Error(`Unexpected fixture request: ${method} ${url}`);
    });
    const redirect = vi.fn();
    expect(await auth(makeMcpOAuthProvider({ ...deps, interactive: true, onRedirect: redirect }), {
      serverUrl: definition.url!, fetchFn: fetchFixture,
    })).toBe('REDIRECT');
    expect(registrations).toEqual([{
      client_name: deps.clientName, redirect_uris: [deps.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: 'none', scope: requestedScopes,
    }]);
    const consent = redirect.mock.calls[0][0] as URL;
    expect(`${consent.origin}${consent.pathname}`).toBe(authorizationServerMetadata.authorization_endpoint);
    expect(consent.searchParams.get('scope')).toBe(requestedScopes);
    expect(consent.searchParams.get('resource')).toBe(resource);
    expect(consent.searchParams.get('state')).toBe(saved.authorizationState);
    const verifier = saved.codeVerifier!;
    expect(consent.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(consent.searchParams.get('code_challenge_method')).toBe('S256');
    delete saved.authorizationState;
    delete saved.authorizationExpiresAt;
    saved.revision = String(++revision);
    expect(await auth(makeMcpOAuthProvider(deps), {
      serverUrl: definition.url!, authorizationCode: 'fixture-code', fetchFn: fetchFixture,
    })).toBe('AUTHORIZED');
    expect(Object.fromEntries(exchanges[0])).toMatchObject({ grant_type: 'authorization_code', code: 'fixture-code',
      code_verifier: verifier, redirect_uri: deps.redirectUrl, client_id: 'fixture-posthog-client', resource });
    expect(await auth(makeMcpOAuthProvider(deps), { serverUrl: definition.url!, fetchFn: fetchFixture })).toBe('AUTHORIZED');
    expect(Object.fromEntries(exchanges[1])).toMatchObject({ grant_type: 'refresh_token',
      refresh_token: 'fixture-refresh-1', client_id: 'fixture-posthog-client', resource });
    expect(registrations).toHaveLength(1);
    expect(saved.tokens?.access_token).toBe('fixture-access-2');
  });
});
