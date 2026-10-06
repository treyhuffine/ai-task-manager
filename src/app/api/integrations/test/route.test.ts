import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { HOSTED_MCP_PROVIDERS } from '@integrations/engine/providers';
import type { McpServerEntry } from '@/lib/integrations/mcp-servers';

const mocked = vi.hoisted(() => ({
  getRuntime: vi.fn(), getConnection: vi.fn(), listServers: vi.fn(), getOAuthState: vi.fn(), openSecret: vi.fn(), invalidate: vi.fn(),
}));
vi.mock('@/lib/integrations/runtime', () => ({
  getIntegrationRuntime: mocked.getRuntime,
  getIntegrationOwnerId: () => 'local',
  getIntegrationConnectionStore: () => ({ get: mocked.getConnection }),
  getMcpServerStore: () => ({ list: mocked.listServers, getOAuthState: mocked.getOAuthState, openSecret: mocked.openSecret }),
  invalidateIntegrationRuntime: mocked.invalidate,
}));

import { POST } from './route';

const server: McpServerEntry = {
  id: 'hosted-server', providerId: 'todoist', connectionId: 'todoist-connection',
  slug: 'builtin_todoist', displayName: 'Todoist', url: 'https://ai.todoist.net/mcp',
  enabled: true, auth: { kind: 'oauth' }, lastStatus: 'ok', createdAt: 'then', updatedAt: 'then',
};

function testRequest() {
  return new NextRequest('http://localhost:42241/api/integrations/test', {
    method: 'POST', body: JSON.stringify({ id: 'todoist-connection' }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocked.getConnection.mockResolvedValue({ connection: { id: 'todoist-connection', providerId: 'todoist', ownerId: 'local' } });
  mocked.getRuntime.mockResolvedValue({});
  mocked.listServers.mockReturnValue([server]);
  mocked.getOAuthState.mockResolvedValue({ tokens: { access_token: 'fixture-token' } });
});

describe('hosted connection health', () => {
  it.each(HOSTED_MCP_PROVIDERS.filter((provider) => provider.auth?.kind === 'bearer').map((provider) => provider.id))('checks %s bearer credentials instead of OAuth state', async (providerId) => {
    mocked.getConnection.mockResolvedValue({ connection: { id: 'todoist-connection', providerId, ownerId: 'local' } });
    mocked.listServers.mockReturnValue([{ ...server, providerId, auth: { kind: 'bearer' } }]);
    mocked.openSecret.mockResolvedValue('fixture-token');
    let response = await POST(testRequest());
    expect(await response.json()).toMatchObject({ ok: true, status: 'active' });
    expect(mocked.getOAuthState).not.toHaveBeenCalled();
    mocked.listServers.mockReturnValue([{ ...server, providerId, auth: { kind: 'bearer' }, lastStatus: 'unreachable', lastError: 'Service unavailable' }]);
    response = await POST(testRequest());
    expect(await response.json()).toMatchObject({ ok: false, status: 'error', error: 'Service unavailable' });
    mocked.openSecret.mockResolvedValue(null);
    mocked.listServers.mockReturnValue([{ ...server, providerId, auth: { kind: 'bearer' }, lastStatus: 'unreachable' }]);
    response = await POST(testRequest());
    expect(await response.json()).toMatchObject({ ok: false, status: 'needs_reauth', error: expect.stringContaining('Update the connection token') });
  });
  it('tests by rebuilding the hosted tools and reports a healthy authorized connection', async () => {
    const response = await POST(testRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ connectionId: 'todoist-connection', ok: true, status: 'active', verified: true });
    expect(mocked.invalidate).toHaveBeenCalledOnce();
    expect(mocked.getRuntime).toHaveBeenCalledOnce();
  });

  it('reports a transient outage without asking the user to sign in again', async () => {
    mocked.listServers.mockReturnValue([{ ...server, lastStatus: 'unreachable', lastError: 'Service unavailable' }]);
    const response = await POST(testRequest());
    expect(await response.json()).toMatchObject({ ok: false, status: 'error', error: 'Service unavailable' });
  });

  it('requests sign-in when OAuth credentials are missing or revoked', async () => {
    mocked.listServers.mockReturnValue([{ ...server, lastStatus: 'unreachable' }]);
    mocked.getOAuthState.mockResolvedValue({ clientInformation: { client_id: 'registered-client' } });
    const response = await POST(testRequest());
    expect(await response.json()).toMatchObject({ ok: false, status: 'needs_reauth', error: 'Sign in to reconnect Todoist.' });
  });

  it('requests sign-in for a legacy connection without a hosted entry', async () => {
    mocked.listServers.mockReturnValue([]);
    const response = await POST(testRequest());
    expect(await response.json()).toMatchObject({ ok: false, status: 'needs_reauth', error: 'Sign in to reconnect Todoist.' });
    expect(mocked.getOAuthState).not.toHaveBeenCalled();
  });

  it('does not mistake cached successful health on a disabled server for an active connection', async () => {
    mocked.listServers.mockReturnValue([{ ...server, enabled: false }]);
    const response = await POST(testRequest());
    expect(await response.json()).toMatchObject({ ok: false, status: 'needs_reauth' });
  });
});
