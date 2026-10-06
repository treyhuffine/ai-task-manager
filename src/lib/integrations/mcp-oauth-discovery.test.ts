import { createHash } from 'node:crypto';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { getHostedMcpProvider } from '@integrations/engine/providers';
import { describe, expect, it, vi } from 'vitest';
import { makeMcpOAuthProvider, type McpOAuthState } from './mcp-oauth';

// Public metadata observed with GET-only SDK discovery on 2026-09-28. Every
// request in these tests is intercepted. DCR and consent never reach a service.
const profiles = [
  {
    id: 'linear', url: 'https://mcp.linear.app/mcp', resource: 'https://mcp.linear.app/mcp',
    resourcePath: '/.well-known/oauth-protected-resource/mcp', issuer: 'https://mcp.linear.app',
    oauthPath: '', scopes: ['read', 'write'], authScopes: ['read', 'write', 'openid', 'email'],
  },
  {
    id: 'notion', url: 'https://mcp.notion.com/mcp', resource: 'https://mcp.notion.com/mcp',
    resourcePath: '/.well-known/oauth-protected-resource/mcp', issuer: 'https://mcp.notion.com',
    oauthPath: '', scopes: ['default'], authScopes: ['default'],
  },
  {
    id: 'calendly', url: 'https://mcp.calendly.com', resource: 'https://mcp.calendly.com/',
    resourcePath: '/.well-known/oauth-protected-resource', issuer: 'https://calendly.com/',
    oauthPath: '/oauth', scopes: ['mcp:scheduling:read', 'mcp:scheduling:write'], authScopes: undefined,
  },
  {
    id: 'resend', url: 'https://mcp.resend.com/mcp', resource: 'https://mcp.resend.com',
    resourcePath: '/.well-known/oauth-protected-resource', issuer: 'https://api.resend.com',
    oauthPath: '/oauth', scopes: undefined, authScopes: ['full_access', 'emails:send'],
  },
];

describe('hosted replacement OAuth profiles', () => {
  it.each(profiles)('uses discovered public-client metadata and scopes for $id', async (profile) => {
    expect(getHostedMcpProvider(profile.id)).toMatchObject({ url: profile.url });
    expect(getHostedMcpProvider(profile.id)?.auth?.kind ?? 'oauth').toBe('oauth');
    const origin = new URL(profile.issuer).origin;
    const registerUrl = `${origin}${profile.oauthPath}/register`;
    const authorizationUrl = `${origin}${profile.oauthPath}/authorize`;
    const metadataUrl = `${origin}/.well-known/oauth-authorization-server`;
    const resourceMetadataUrl = new URL(profile.resourcePath, profile.url).href;
    let saved: McpOAuthState = {};
    let revision = 0;
    const redirect = vi.fn();
    const provider = makeMcpOAuthProvider({
      redirectUrl: 'https://app.example/oauth/callback', clientName: 'Integration fixture', interactive: true,
      load: async () => structuredClone(saved),
      compareAndSave: async (expected, state) => {
        if (saved.revision !== expected) return null;
        saved = structuredClone({ ...state, revision: String(++revision) });
        return structuredClone(saved);
      },
      onRedirect: redirect,
    });
    const registrations: Record<string, unknown>[] = [];
    const fetchFixture = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === registerUrl && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        registrations.push(body);
        return Response.json({ ...body, client_id: 'fixture-client',
          // Resend's documented omitted-scope default is every supported scope.
          ...(profile.id === 'resend' ? { scope: 'full_access emails:send' } : {}),
        });
      }
      if (method !== 'GET') throw new Error(`Unexpected fixture request: ${method} ${url}`);
      if (url === resourceMetadataUrl) return Response.json({
        resource: profile.resource, authorization_servers: [profile.issuer], bearer_methods_supported: ['header'],
        ...(profile.scopes ? { scopes_supported: profile.scopes } : {}),
      });
      if (url === metadataUrl) return Response.json({
        issuer: profile.issuer, authorization_endpoint: authorizationUrl,
        token_endpoint: `${origin}${profile.oauthPath}/token`, registration_endpoint: registerUrl,
        response_types_supported: ['code'], code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        ...(profile.authScopes ? { scopes_supported: profile.authScopes } : {}),
      });
      if (profile.id === 'resend' && url === 'https://mcp.resend.com/.well-known/oauth-protected-resource/mcp') {
        return new Response(null, { status: 404 });
      }
      throw new Error(`Unexpected fixture request: ${method} ${url}`);
    });

    expect(await auth(provider, { serverUrl: profile.url, fetchFn: fetchFixture })).toBe('REDIRECT');
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toEqual({
      client_name: 'Integration fixture', redirect_uris: ['https://app.example/oauth/callback'],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
      ...(profile.scopes ? { scope: profile.scopes.join(' ') } : {}),
    });
    expect(redirect).toHaveBeenCalledOnce();
    const target = redirect.mock.calls[0][0] as URL;
    expect(`${target.origin}${target.pathname}`).toBe(authorizationUrl);
    expect(target.searchParams.get('scope')).toBe(profile.scopes?.join(' ') ?? null);
    expect(target.searchParams.get('resource')).toBe(new URL(profile.resource).href);
    expect(target.searchParams.get('client_id')).toBe('fixture-client');
    expect(target.searchParams.get('state')).toBe(saved.authorizationState);
    expect(saved.authorizationState).toBeTruthy();
    expect(saved.codeVerifier).toBeTruthy();
    expect(target.searchParams.get('code_challenge_method')).toBe('S256');
    expect(target.searchParams.get('code_challenge')).toBe(createHash('sha256').update(saved.codeVerifier!).digest('base64url'));
    expect(fetchFixture.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
});
