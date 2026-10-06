import { createHash } from 'node:crypto';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { getHostedMcpProvider } from '@integrations/engine/providers';
import { describe, expect, it, vi } from 'vitest';
import { resolveHostedMcpUrl } from './hosted-endpoint';
import { makeMcpOAuthProvider, type McpOAuthProviderDeps, type McpOAuthState } from './mcp-oauth';

// Public metadata and anonymous initialize responses observed 2026-09-28.
// PayPal's quickstart still lists /http, which returned 404 in both environments.
// The live /mcp transport challenges point to the resource metadata used below.
// DCR and token responses are synthetic. Every network request is intercepted.
const profiles = [
  { environment: 'production', origin: 'https://mcp.paypal.com' },
  { environment: 'sandbox', origin: 'https://mcp.sandbox.paypal.com' },
] as const;
const scopes = ['openid', 'email', 'profile'];

describe('PayPal hosted MCP OAuth profiles', () => {
  it.each(profiles)('pins $environment discovery, public DCR, consent, code exchange and refresh to its environment', async (profile) => {
    const definition = getHostedMcpProvider('paypal');
    expect(definition).toMatchObject({ defaultMutationRisk: 'high', endpoint: { kind: 'region', label: 'PayPal environment' } });
    if (!definition) throw new Error('Missing PayPal catalog definition');
    const url = resolveHostedMcpUrl(definition, { endpointId: profile.environment });
    expect(url).toBe(`${profile.origin}/mcp`);
    const catalogAuth = definition.auth ?? { kind: 'oauth' as const };
    if (catalogAuth.kind !== 'oauth') throw new Error('Expected catalog OAuth profile');
    expect(catalogAuth.registration).toBeUndefined();
    expect(catalogAuth.tokenEndpointAuthMethod ?? 'none').toBe('none');
    expect(catalogAuth.grantTypes ?? ['authorization_code', 'refresh_token']).toEqual(['authorization_code', 'refresh_token']);

    let saved: McpOAuthState = {};
    let revision = 0;
    const deps: McpOAuthProviderDeps = {
      redirectUrl: 'http://127.0.0.1:45123/mcp/callback', clientName: 'Integration fixture',
      grantTypes: catalogAuth.grantTypes, tokenEndpointAuthMethod: catalogAuth.tokenEndpointAuthMethod,
      load: async () => structuredClone(saved),
      compareAndSave: async (expected, state) => {
        if (saved.revision !== expected) return null;
        saved = structuredClone({ ...state, revision: String(++revision) });
        return structuredClone(saved);
      },
    };
    const clientId = `fixture-paypal-${profile.environment}`;
    const registrations: Record<string, unknown>[] = [];
    const tokenBodies: URLSearchParams[] = [];
    const fetchFixture = vi.fn<typeof fetch>(async (input, init) => {
      const requestUrl = String(input);
      const method = init?.method ?? 'GET';
      // An environment must never discover metadata or send authorization
      // codes, refresh tokens or registration information to the other one.
      expect(new URL(requestUrl).origin).toBe(profile.origin);
      if (method === 'GET' && requestUrl === `${profile.origin}/.well-known/oauth-protected-resource/mcp`) {
        return Response.json({
          resource: url, authorization_servers: [profile.origin],
          scopes_supported: scopes, bearer_methods_supported: ['header'],
        });
      }
      if (method === 'GET' && requestUrl === `${profile.origin}/.well-known/oauth-authorization-server`) {
        return Response.json({
          issuer: profile.origin, authorization_endpoint: `${profile.origin}/authorize`,
          token_endpoint: `${profile.origin}/token`, registration_endpoint: `${profile.origin}/register`,
          response_types_supported: ['code'], response_modes_supported: ['query'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
          revocation_endpoint: `${profile.origin}/token`, code_challenge_methods_supported: ['S256'],
          client_id_metadata_document_supported: false,
        });
      }
      if (method === 'POST' && requestUrl === `${profile.origin}/register`) {
        const body = JSON.parse(String(init?.body));
        registrations.push(body);
        return Response.json({ ...body, client_id: clientId });
      }
      if (method === 'POST' && requestUrl === `${profile.origin}/token`) {
        const body = new URLSearchParams(String(init?.body));
        tokenBodies.push(body);
        expect(new Headers(init?.headers).has('Authorization')).toBe(false);
        expect(body.has('client_secret')).toBe(false);
        return Response.json({
          access_token: `fixture-${profile.environment}-access-${tokenBodies.length}`,
          refresh_token: `fixture-${profile.environment}-refresh-${tokenBodies.length}`,
          token_type: 'Bearer', scope: scopes.join(' '),
        });
      }
      throw new Error(`Unexpected fixture request: ${method} ${requestUrl}`);
    });

    const redirect = vi.fn();
    const interactive = makeMcpOAuthProvider({ ...deps, interactive: true, onRedirect: redirect });
    expect(await auth(interactive, { serverUrl: url, fetchFn: fetchFixture })).toBe('REDIRECT');
    expect(registrations).toEqual([{
      client_name: deps.clientName, redirect_uris: [deps.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: 'none', scope: scopes.join(' '),
    }]);
    expect(saved.clientInformation).not.toHaveProperty('client_secret');
    const consentUrl = redirect.mock.calls[0][0] as URL;
    expect(`${consentUrl.origin}${consentUrl.pathname}`).toBe(`${profile.origin}/authorize`);
    expect(consentUrl.searchParams.get('scope')).toBe(scopes.join(' '));
    expect(consentUrl.searchParams.get('resource')).toBe(url);
    expect(consentUrl.searchParams.get('client_id')).toBe(clientId);
    expect(consentUrl.searchParams.get('redirect_uri')).toBe(deps.redirectUrl);
    expect(consentUrl.searchParams.get('state')).toBe(saved.authorizationState);
    expect(consentUrl.searchParams.get('code_challenge_method')).toBe('S256');
    const verifier = saved.codeVerifier!;
    expect(consentUrl.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));

    // The host consumes state once before exchanging the returned code.
    saved = { ...saved, revision: String(++revision) };
    delete saved.authorizationState;
    delete saved.authorizationExpiresAt;
    const callback = makeMcpOAuthProvider(deps);
    expect(await auth(callback, { serverUrl: url, authorizationCode: 'fixture-code', fetchFn: fetchFixture })).toBe('AUTHORIZED');
    expect(Object.fromEntries(tokenBodies[0])).toMatchObject({
      grant_type: 'authorization_code', code: 'fixture-code', code_verifier: verifier,
      client_id: clientId, redirect_uri: deps.redirectUrl, resource: url,
    });
    const background = makeMcpOAuthProvider(deps);
    expect(await auth(background, { serverUrl: url, fetchFn: fetchFixture })).toBe('AUTHORIZED');
    expect(Object.fromEntries(tokenBodies[1])).toMatchObject({
      grant_type: 'refresh_token', refresh_token: `fixture-${profile.environment}-refresh-1`,
      client_id: clientId, resource: url,
    });
    expect(tokenBodies).toHaveLength(2);
    expect(registrations).toHaveLength(1);
    expect(saved.tokens).toMatchObject({
      access_token: `fixture-${profile.environment}-access-2`,
      refresh_token: `fixture-${profile.environment}-refresh-2`,
    });
  });

  it('requires an explicit supported environment and never accepts a replacement server URL', () => {
    const definition = getHostedMcpProvider('paypal');
    if (!definition) throw new Error('Missing PayPal catalog definition');
    expect(() => resolveHostedMcpUrl(definition)).toThrow();
    expect(() => resolveHostedMcpUrl(definition, { endpointId: 'unknown' })).toThrow();
    expect(() => resolveHostedMcpUrl(definition, { endpointId: 'production', instanceUrl: 'https://attacker.example/mcp' })).toThrow();
  });
});
