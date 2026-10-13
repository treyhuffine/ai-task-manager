import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { connectMcpClient } from '@integrations/engine/mcp';
import { getHostedMcpProvider } from '@integrations/engine/providers';
import { APP_ROOT_ENV } from '@/lib/config/paths';
import { ensureHostedMcpServer } from './hosted-mcp';
import { getIntegrationConnectionStore, getIntegrationRuntime, getMcpServerStore, getProviderStatuses, invalidateIntegrationRuntime, mcpOAuthProviderFor } from './runtime';

vi.mock('@/lib/db/queries', () => ({ getWorkspace: vi.fn() }));
let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openseo-selfhost-'));
  vi.stubEnv(APP_ROOT_ENV, dir);
  invalidateIntegrationRuntime();
});
afterEach(() => {
  invalidateIntegrationRuntime();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('OpenSEO self-hosted transport and host stores', () => {
  it('discovers and dispatches Docker tools without auth while treating self-hosted annotations conservatively', async () => {
    const entry = await ensureHostedMcpServer(getHostedMcpProvider('openseo')!, getMcpServerStore(), getIntegrationConnectionStore(), 'local', {
      endpointId: 'selfhosted', instanceUrl: 'http://localhost:3000', authMethod: 'none',
    });
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      expect(request.url).toBe(entry.url);
      expect(request.headers.has('Authorization')).toBe(false);
      if (request.method === 'GET') return new Response(null, { status: 405 });
      const message = await request.json() as { id?: number; method: string };
      calls.push(message.method);
      if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
      const result = message.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'OpenSEO self-hosted', version: 'fixture' } }
        : message.method === 'tools/list' ? { tools: [
          { name: 'list_projects', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true, destructiveHint: false } },
          { name: 'set_report_sharing', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true, destructiveHint: false } },
        ] }
          : { content: [{ type: 'text', text: 'Projects' }], structuredContent: { projects: [] } };
      return Response.json({ jsonrpc: '2.0', id: message.id, result });
    }));
    const runtime = await getIntegrationRuntime();
    expect(await runtime.runAction('openseo.list_projects', {})).toMatchObject({ ok: true });
    const actions = runtime.getToolkits().find(toolkit => toolkit.id === 'openseo')!.actions;
    expect(actions.find(action => action.id === 'openseo.set_report_sharing')).toMatchObject({ mutating: true });
    expect(calls).toContain('tools/call');
    const status = (await getProviderStatuses()).find(provider => provider.id === 'openseo')!;
    expect(status.mcp?.accounts[0]).toMatchObject({ requiresAuth: false, authKind: 'none', status: 'ok', endpointConfig: {
      kind: 'deployment', selectedId: 'selfhosted', selectedUrl: 'http://localhost:3000', selectedAuthMethod: 'none', locked: true,
    } });
  });

  it.each([
    { channel: 'web' as const, redirectUri: 'https://ri.example/api/integrations/mcp-oauth/fixture' },
    { channel: 'desktop' as const, redirectUri: 'http://127.0.0.1:45123/mcp/callback' },
  ])('discovers instance OAuth scopes, registers and exchanges PKCE through the real SDK for $channel', async ({ channel, redirectUri }) => {
    const entry = await ensureHostedMcpServer(getHostedMcpProvider('openseo')!, getMcpServerStore(), getIntegrationConnectionStore(), 'local', {
      endpointId: 'selfhosted', instanceUrl: 'https://seo.example', authMethod: 'oauth',
    });
    // A Managed OAuth discovery fixture. The instance supplies the issuer and scopes.
    const issuer = 'https://team.cloudflareaccess.com';
    const metadata = { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, registration_endpoint: `${issuer}/register`,
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'], scopes_supported: ['openid', 'email'] };
    const registrations: Record<string, unknown>[] = [];
    const exchanges: URLSearchParams[] = [];
    const fetchFixture = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      if (request.url === entry.url) return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Bearer resource_metadata="https://seo.example/.well-known/oauth-protected-resource/mcp"' } });
      if (request.url === 'https://seo.example/.well-known/oauth-protected-resource/mcp') return Response.json({ resource: entry.url, authorization_servers: [issuer], scopes_supported: ['openid', 'email'] });
      if (request.url === `${issuer}/.well-known/oauth-authorization-server`) return Response.json(metadata);
      if (request.url === metadata.registration_endpoint) {
        const body = await request.json(); registrations.push(body);
        return Response.json({ ...body, client_id: 'selfhost-fixture-client' });
      }
      if (request.url === metadata.token_endpoint) {
        const body = new URLSearchParams(await request.text()); exchanges.push(body);
        return Response.json({ access_token: 'selfhost-access-token', refresh_token: 'selfhost-refresh-token', token_type: 'Bearer' });
      }
      throw new Error(`Unexpected fixture URL: ${request.url}`);
    });
    vi.stubGlobal('fetch', fetchFixture);
    const redirect = vi.fn();
    const provider = mcpOAuthProviderFor(entry, redirect, { redirectUri, callbackChannel: channel, interactive: true });
    await expect(connectMcpClient({ url: entry.url, authProvider: provider })).rejects.toThrow();
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({ redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' });
    expect(registrations[0].scope).toBe('openid email');
    expect(JSON.stringify(registrations)).not.toContain('offline_access');
    const consent = redirect.mock.calls[0][0] as URL;
    expect(consent.origin).toBe(issuer);
    expect(consent.searchParams.get('scope')).toBe('openid email');
    expect(consent.searchParams.get('resource')).toBe(entry.url);
    expect(consent.searchParams.get('code_challenge_method')).toBe('S256');
    expect(await auth(provider, { serverUrl: entry.url, authorizationCode: 'selfhost-code', fetchFn: fetchFixture })).toBe('AUTHORIZED');
    expect(Object.fromEntries(exchanges[0])).toMatchObject({ client_id: 'selfhost-fixture-client', redirect_uri: redirectUri, resource: entry.url, code_verifier: expect.any(String) });
    expect(exchanges[0].has('client_secret')).toBe(false);
    const resumed = mcpOAuthProviderFor(entry);
    expect(await resumed.tokens()).toMatchObject({ access_token: 'selfhost-access-token' });
    expect(resumed.redirectUrl).toBe(redirectUri);
    expect(await auth(resumed, { serverUrl: entry.url, fetchFn: fetchFixture })).toBe('AUTHORIZED');
    expect(Object.fromEntries(exchanges[1])).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'selfhost-refresh-token', resource: entry.url });
    expect(registrations).toHaveLength(1);
    expect(await getMcpServerStore().openSecret(entry.id)).toBeNull();
  });
});
