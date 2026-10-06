import { createHash } from 'node:crypto';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { getHostedMcpProvider } from '@integrations/engine/providers';
import { describe, expect, it, vi } from 'vitest';
import { makeMcpOAuthProvider, type McpOAuthProviderDeps, type McpOAuthState } from './mcp-oauth';

// Public GET-only discovery observed 2026-09-28. DCR and token responses below
// are synthetic: every request is intercepted and no account is contacted.
const profiles = [
  {
    id: 'airtable', url: 'https://mcp.airtable.com/mcp', resource: 'https://mcp.airtable.com',
    resourceMetadataUrl: 'https://mcp.airtable.com/.well-known/oauth-protected-resource/mcp',
    issuer: 'https://airtable.com/oauth2/v1',
    metadataUrl: 'https://airtable.com/.well-known/oauth-authorization-server/oauth2/v1',
    authorizeUrl: 'https://airtable.com/oauth2/v1/authorize', tokenUrl: 'https://airtable.com/oauth2/v1/token',
    registerUrl: 'https://airtable.com/oauth2/v1/register', methods: ['client_secret_basic', 'none'],
    grants: undefined,
    scopes: ['data.records:read', 'data.records:write', 'schema.bases:read', 'schema.bases:write',
      'data.recordComments:read', 'data.recordComments:write', 'workspacesAndBases:read'],
  },
  {
    id: 'atlassian', url: 'https://mcp.atlassian.com/v2/mcp?tools=all', resource: 'https://mcp.atlassian.com/v2/mcp',
    resourceMetadataUrl: 'https://mcp.atlassian.com/.well-known/oauth-protected-resource/v2/mcp?tools=all',
    issuer: 'https://auth.atlassian.com/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3',
    metadataUrl: 'https://auth.atlassian.com/.well-known/oauth-authorization-server/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3',
    authorizeUrl: 'https://auth.atlassian.com/authorize', tokenUrl: 'https://auth.atlassian.com/oauth/token',
    registerUrl: 'https://auth.atlassian.com/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3/dcr/register',
    methods: ['none', 'client_secret_post', 'client_secret_basic', 'private_key_jwt'],
    grants: ['authorization_code', 'client_credentials', 'refresh_token', 'urn:ietf:params:oauth:grant-type:token-revoke',
      'urn:ietf:params:oauth:grant-type:jwt-bearer', 'urn:ietf:params:oauth:grant-type:token-exchange'],
    scopes: ['read:me', 'read:account', 'offline_access', 'email',
      'read:jira:agent-interface', 'write:jira:agent-interface', 'search:jira:agent-interface',
      'delete:jira:agent-interface', 'manage:jira:agent-interface',
      'read:confluence:agent-interface', 'write:confluence:agent-interface', 'search:confluence:agent-interface',
      'search:rovo:agent-interface', 'search:code:agent-interface', 'read:all:twg', 'write:all:twg',
      'read:goals:agent-interface', 'write:goals:agent-interface', 'read:projects:agent-interface', 'write:projects:agent-interface',
      'read:bitbucket:agent-interface', 'write:bitbucket:agent-interface', 'read:loom:agent-interface', 'write:loom:agent-interface',
      'read:talent:agent-interface', 'write:talent:agent-interface', 'read:jira-align:agent-interface', 'write:jira-align:agent-interface',
      'read:teams:agent-interface', 'write:teams:agent-interface', 'read:artifacts:agent-interface', 'write:artifacts:agent-interface',
      'read:capacity-planning:agent-interface', 'write:capacity-planning:agent-interface',
      'read:focus:agent-interface', 'write:focus:agent-interface', 'read:assets:agent-interface', 'write:assets:agent-interface'],
  },
];

describe('Airtable and Atlassian hosted OAuth profiles', () => {
  it.each(profiles)('uses $id public DCR, discovered scopes and resource binding through refresh', async (profile) => {
    const definition = getHostedMcpProvider(profile.id);
    expect(definition).toMatchObject({ url: profile.url, defaultMutationRisk: 'high' });
    const catalogAuth = definition?.auth ?? { kind: 'oauth' as const };
    if (catalogAuth.kind !== 'oauth') throw new Error('Expected catalog OAuth profile');
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
    const registrations: Record<string, unknown>[] = [];
    const tokenBodies: URLSearchParams[] = [];
    const fetchFixture = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === profile.resourceMetadataUrl && method === 'GET') return Response.json({
        resource: profile.resource, authorization_servers: [profile.issuer], scopes_supported: profile.scopes,
        bearer_methods_supported: ['header'],
      });
      if (url === profile.metadataUrl && method === 'GET') return Response.json({
        issuer: profile.issuer, authorization_endpoint: profile.authorizeUrl, token_endpoint: profile.tokenUrl,
        registration_endpoint: profile.registerUrl, response_types_supported: ['code'],
        token_endpoint_auth_methods_supported: profile.methods, code_challenge_methods_supported: ['S256'],
        client_id_metadata_document_supported: true,
        ...(profile.grants ? { grant_types_supported: profile.grants } : { scopes_supported: profile.scopes }),
      });
      if (url === profile.registerUrl && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        registrations.push(body);
        return Response.json({ ...body, client_id: `fixture-${profile.id}` });
      }
      if (url === profile.tokenUrl && method === 'POST') {
        const body = new URLSearchParams(String(init?.body));
        tokenBodies.push(body);
        expect(new Headers(init?.headers).has('Authorization')).toBe(false);
        expect(body.has('client_secret')).toBe(false);
        return Response.json({ access_token: `fixture-access-${tokenBodies.length}`, token_type: 'Bearer',
          refresh_token: `fixture-refresh-${tokenBodies.length}`, scope: profile.scopes.join(' ') });
      }
      throw new Error(`Unexpected fixture request: ${method} ${url}`);
    });
    const redirect = vi.fn();
    const interactive = makeMcpOAuthProvider({ ...deps, interactive: true, onRedirect: redirect });
    expect(await auth(interactive, { serverUrl: profile.url, fetchFn: fetchFixture })).toBe('REDIRECT');
    expect(registrations).toEqual([{
      client_name: deps.clientName, redirect_uris: [deps.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: 'none', scope: profile.scopes.join(' '),
    }]);
    const consentUrl = redirect.mock.calls[0][0] as URL;
    expect(`${consentUrl.origin}${consentUrl.pathname}`).toBe(profile.authorizeUrl);
    expect(consentUrl.searchParams.get('scope')).toBe(profile.scopes.join(' '));
    expect(consentUrl.searchParams.get('resource')).toBe(new URL(profile.resource).href);
    expect(consentUrl.searchParams.get('prompt')).toBe(profile.id === 'atlassian' ? 'consent' : null);
    expect(consentUrl.searchParams.get('state')).toBe(saved.authorizationState);
    const verifier = saved.codeVerifier!;
    expect(consentUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(consentUrl.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));

    saved = { ...saved, revision: String(++revision) };
    delete saved.authorizationState;
    delete saved.authorizationExpiresAt;
    const callback = makeMcpOAuthProvider(deps);
    expect(await auth(callback, { serverUrl: profile.url, authorizationCode: 'fixture-code', fetchFn: fetchFixture })).toBe('AUTHORIZED');
    expect(Object.fromEntries(tokenBodies[0])).toMatchObject({
      grant_type: 'authorization_code', code: 'fixture-code', code_verifier: verifier,
      client_id: `fixture-${profile.id}`, redirect_uri: deps.redirectUrl, resource: new URL(profile.resource).href,
    });
    const background = makeMcpOAuthProvider(deps);
    expect(await auth(background, { serverUrl: profile.url, fetchFn: fetchFixture })).toBe('AUTHORIZED');
    expect(Object.fromEntries(tokenBodies[1])).toMatchObject({
      grant_type: 'refresh_token', refresh_token: 'fixture-refresh-1', client_id: `fixture-${profile.id}`,
      resource: new URL(profile.resource).href,
    });
    expect(registrations).toHaveLength(1);
    expect(saved.tokens?.access_token).toBe('fixture-access-2');
  });
});
