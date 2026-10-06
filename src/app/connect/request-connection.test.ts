import { HOSTED_MCP_PROVIDERS } from '@integrations/engine/providers';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionRequest } from './connection-request';
import ConnectPage from './page';
import { requestConnection, selectRequestAccount } from './request-connection';

const savedServers = vi.hoisted(() => ({ entries: [] as Array<Record<string, unknown>>, statuses: [] as Array<Record<string, unknown>>, previous: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/integrations/runtime', () => ({ getMcpServerStore: () => ({ list: () => savedServers.entries }), getProviderStatuses: async () => savedServers.statuses,
  getIntegrationOwnerId: () => 'local', getIntegrationConnectionStore: () => ({ list: async () => savedServers.previous }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
beforeEach(() => { savedServers.entries = []; savedServers.statuses = []; savedServers.previous = []; });

describe('account-specific agent connection requests', () => {
  it('offers previous native accounts for explicit migration without reusing the native app', async () => {
    savedServers.previous = ['Personal', 'Work'].map(label => ({ id: `old-${label}`, providerId: 'slack', label, accountId: label, authConfigId: 'retired-native-app' }));
    savedServers.statuses = [{ id: 'slack', configured: true, mcp: { accounts: [] } }];
    const page = await ConnectPage({ searchParams: Promise.resolve({ provider: 'slack' }) });
    expect(renderToStaticMarkup(page)).toContain('Choose an account');
    const options = selectRequestAccount(page.props, 'old-Work');
    expect(options.authConfigId).toBeUndefined();
    const post = vi.fn(async () => ({ authUrl: 'https://vendor.example/authorize' }));
    await requestConnection(options, { post, openAuthorization: vi.fn() });
    expect(post).toHaveBeenCalledWith('/integrations/connect', expect.objectContaining({ existingConnectionId: 'old-Work', authConfigId: undefined }));
  });
  it('requires a choice and replaces only the selected bearer account token', async () => {
    savedServers.entries = ['Personal', 'Work'].map(label => ({
      id: `server-${label}`, providerId: 'github', slug: `builtin_github_${label}`, displayName: label,
      connectionId: `connection-${label}`, accountId: `account-${label}`, url: 'https://api.githubcopilot.com/mcp/', auth: { kind: 'bearer' }, enabled: true,
    }));
    const page = await ConnectPage({ searchParams: Promise.resolve({ provider: 'github' }) });
    const html = renderToStaticMarkup(page);
    expect(html).toContain('Choose an account');
    expect(html).toContain('Personal');
    expect(html).toContain('Work');
    const post = vi.fn(async () => ({ connection: { id: 'connection-Work' } }));
    const openAuthorization = vi.fn();
    await expect(requestConnection({ ...page.props, token: 'work-token' }, { post, openAuthorization })).rejects.toThrow('Choose the account');
    expect(post).not.toHaveBeenCalled();
    await requestConnection({ ...selectRequestAccount(page.props, 'connection-Work'), token: 'work-token' }, { post, openAuthorization });
    expect(post).toHaveBeenCalledExactlyOnceWith('/integrations/connectDirect', {
      providerId: 'github', fields: { token: 'work-token' }, serverId: 'server-Work', existingConnectionId: 'connection-Work',
    });
  });

  it('uses the requested registered account app rather than an aggregate or query app', async () => {
    savedServers.entries = ['Personal', 'Work'].map(label => ({
      id: `server-${label}`, providerId: 'slack', slug: `builtin_slack_${label}`, displayName: label,
      connectionId: `connection-${label}`, authConfigId: `app-${label}`, url: 'https://mcp.slack.com/mcp', auth: { kind: 'oauth' }, enabled: true,
    }));
    savedServers.statuses = [{ id: 'slack', configured: true, mcp: { oauthRegistration: 'registered', authConfigId: 'wrong-aggregate',
      accounts: [{ serverId: 'server-Personal', configured: true }, { serverId: 'server-Work', configured: true }],
    } }];
    const page = await ConnectPage({ searchParams: Promise.resolve({ provider: 'slack', connection: 'connection-Work', client: 'wrong-query' }) });
    expect(page.props).toMatchObject({ authConfigId: 'app-Work', serverId: 'server-Work', existingConnectionId: 'connection-Work' });
    const post = vi.fn(async () => ({ authUrl: 'https://vendor.example/authorize' }));
    await requestConnection(page.props, { post, openAuthorization: vi.fn() });
    expect(post).toHaveBeenCalledExactlyOnceWith('/integrations/connect', {
      providerId: 'slack', scopes: [], authConfigId: 'app-Work', serverId: 'server-Work', existingConnectionId: 'connection-Work',
    });
  });

  it('keeps each requested account endpoint immutable and rejects vanished accounts', async () => {
    savedServers.entries = ['us', 'eu'].map(region => ({
      id: region, providerId: 'intercom', slug: `builtin_intercom_${region}`, displayName: region,
      connectionId: `connection-${region}`, url: region === 'us' ? 'https://mcp.intercom.com/mcp' : 'https://mcp.eu.intercom.com/mcp', auth: { kind: 'oauth' }, enabled: true,
    }));
    const page = await ConnectPage({ searchParams: Promise.resolve({ provider: 'intercom', connection: 'connection-eu', endpointId: 'us' }) });
    expect(page.props.endpointConfig).toMatchObject({ locked: true, selectedId: 'eu' });
    const post = vi.fn(async () => ({ authUrl: 'https://vendor.example/authorize' }));
    await requestConnection({ ...page.props, endpointId: 'us' }, { post, openAuthorization: vi.fn() });
    expect(post).toHaveBeenCalledWith('/integrations/connect', expect.objectContaining({ endpointId: 'eu', serverId: 'eu', existingConnectionId: 'connection-eu' }));
    expect(() => selectRequestAccount(page.props, 'removed-account')).toThrow('no longer available');
  });
});

describe('connection requests from agent conversations', () => {
  it.each(HOSTED_MCP_PROVIDERS.filter((provider) => provider.auth?.kind === 'bearer').map((provider) => provider.id))('selects the named bearer flow for %s at first render', async (provider) => {
    const page = await ConnectPage({ searchParams: Promise.resolve({ provider, connection: 'existing-account' }) });
    expect(page.props).toMatchObject({ providerId: provider, authKind: 'bearer', existingConnectionId: 'existing-account' });
    const html = renderToStaticMarkup(page);
    expect(html).toContain('type="password"');
    expect(html).not.toContain('Continue to sign-in');
    expect(html).toContain('stored encrypted');
    expect(html).not.toContain('Server URL');
    const post = vi.fn(async () => ({ connection: { id: 'existing-account' } }));
    const openAuthorization = vi.fn();
    const definition = HOSTED_MCP_PROVIDERS.find(entry => entry.id === provider)!;
    const region = definition.endpoint?.kind === 'region' ? definition.endpoint.options[0] : undefined;
    const selection = region ? { endpointId: region.id } : {};
    expect(await requestConnection({ ...page.props, ...selection, token: '  fixture-token  ' }, { post, openAuthorization })).toContain('Connected.');
    expect(post).toHaveBeenCalledExactlyOnceWith('/integrations/connectDirect', {
      providerId: provider, fields: { token: 'fixture-token' }, existingConnectionId: 'existing-account', ...selection,
    });
    expect(openAuthorization).not.toHaveBeenCalled();
  });

  it.each(HOSTED_MCP_PROVIDERS.filter((provider) => !provider.endpoint && (provider.auth?.kind ?? 'oauth') === 'oauth' && !(provider.auth?.kind === 'oauth' && provider.auth.registration === 'registered')).map((provider) => provider.id))('preserves browser sign-in for %s', async (provider) => {
    const page = await ConnectPage({ searchParams: Promise.resolve({ provider, scopes: '["read"]', client: 'pinned-client', connection: 'saved-id' }) });
    expect(page.props.authKind).toBe('oauth');
    const html = renderToStaticMarkup(page);
    expect(html).toContain('Continue to sign-in');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('Client ID');
    expect(html).not.toContain('Server URL');
    const post = vi.fn(async () => ({ authorizationUrl: 'https://vendor.example/authorize' }));
    const openAuthorization = vi.fn();
    expect(await requestConnection(page.props, { post, openAuthorization })).toContain('in your browser');
    expect(post).toHaveBeenCalledExactlyOnceWith('/integrations/connect', { providerId: provider, scopes: ['read'], authConfigId: 'pinned-client', existingConnectionId: 'saved-id' });
    expect(openAuthorization).toHaveBeenCalledExactlyOnceWith('https://vendor.example/authorize');
  });

  it.each(HOSTED_MCP_PROVIDERS.filter((provider) => provider.auth?.kind === 'none').map((provider) => provider.id))('connects public catalog service %s without account setup', async (provider) => {
    const page = await ConnectPage({ searchParams: Promise.resolve({ provider }) });
    expect(page.props).toMatchObject({ providerId: provider, authKind: 'none' });
    const html = renderToStaticMarkup(page);
    expect(html).toContain('No account or token is required');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('Continue to sign-in');
    expect(html).not.toContain('Client ID');
    expect(html).not.toContain('Server URL');
    const post = vi.fn(async () => ({ connection: { id: `hosted-${provider}` } }));
    const openAuthorization = vi.fn();
    expect(await requestConnection({ ...page.props, token: 'must-not-be-forwarded' }, { post, openAuthorization })).toContain('Connected.');
    expect(post).toHaveBeenCalledExactlyOnceWith('/integrations/connectDirect', { providerId: provider, fields: {} });
    expect(openAuthorization).not.toHaveBeenCalled();
  });

  it('connects a public service without forwarding a token or opening authorization', async () => {
    const options = { providerId: 'public-fixture', displayName: 'Public service', authKind: 'none' as const, scopes: [] };
    const html = renderToStaticMarkup(createElement(ConnectionRequest, options));
    expect(html).toContain('No account or token is required');
    expect(html).not.toContain('type="password"');
    const post = vi.fn(async () => ({ connection: { id: 'verified' } }));
    const openAuthorization = vi.fn();
    await requestConnection({ ...options, token: 'must-not-be-forwarded' }, { post, openAuthorization });
    expect(post).toHaveBeenCalledExactlyOnceWith('/integrations/connectDirect', { providerId: 'public-fixture', fields: {} });
    expect(openAuthorization).not.toHaveBeenCalled();
  });

  it.each(HOSTED_MCP_PROVIDERS.filter(provider => provider.auth?.kind === 'oauth' && provider.auth.registration === 'registered').map(provider => provider.id))('sends %s to Settings until a registered app is usable', async provider => {
    savedServers.statuses = [{ id: provider, configured: false, mcp: { oauthRegistration: 'registered', redirectUri: `https://app.example/api/integrations/mcp-oauth/builtin_${provider}` } }];
    const page = await ConnectPage({ searchParams: Promise.resolve({ provider, client: 'query-client' }) });
    expect(page.props).toMatchObject({ oauthRegistration: 'registered', configured: false });
    const html = renderToStaticMarkup(page);
    expect(html).toContain('Set up in Settings');
    expect(html).not.toContain('Continue to sign-in');
    expect(html).not.toContain('type="password"');
    const post = vi.fn();
    const openAuthorization = vi.fn();
    await expect(requestConnection(page.props, { post, openAuthorization })).rejects.toThrow('Set up an OAuth app in Settings');
    expect(post).not.toHaveBeenCalled();
    expect(openAuthorization).not.toHaveBeenCalled();
  });

  it.each(HOSTED_MCP_PROVIDERS.filter(provider => provider.auth?.kind === 'oauth' && provider.auth.registration === 'registered').map(provider => provider.id))('pins %s reauthorization to its saved registered app', async provider => {
    const definition = HOSTED_MCP_PROVIDERS.find(entry => entry.id === provider)!;
    const environment = definition.endpoint?.kind === 'region' ? definition.endpoint.options.at(-1) : undefined;
    savedServers.entries = [{
      id: 'saved-server', providerId: provider, slug: `builtin_${provider}`, displayName: 'Work account',
      connectionId: 'saved-connection', authConfigId: 'saved-client',
      url: environment?.url ?? definition.url, auth: { kind: 'oauth' }, enabled: true,
    }];
    savedServers.statuses = [{ id: provider, configured: true, mcp: { oauthRegistration: 'registered', authConfigId: 'saved-client', redirectUri: `https://app.example/api/integrations/mcp-oauth/builtin_${provider}` } }];
    const page = await ConnectPage({ searchParams: Promise.resolve({ provider, client: 'other-query-client', connection: 'saved-connection', endpointId: 'production' }) });
    expect(page.props).toMatchObject({ oauthRegistration: 'registered', configured: true, authConfigId: 'saved-client' });
    if (environment) expect(page.props.endpointConfig).toMatchObject({ locked: true, selectedId: environment.id });
    const html = renderToStaticMarkup(page);
    expect(html).toContain('Continue to sign-in');
    expect(html).toContain('Manage OAuth apps in Settings');
    if (environment) {
      expect(html).toContain(environment.label);
      expect(html).not.toContain('<select');
    }
    const post = vi.fn(async () => ({ authorizationUrl: 'https://vendor.example/authorize' }));
    const openAuthorization = vi.fn();
    await requestConnection({ ...page.props, endpointId: 'production' }, { post, openAuthorization });
    expect(post).toHaveBeenCalledExactlyOnceWith('/integrations/connect', {
      providerId: provider, scopes: [], authConfigId: 'saved-client', existingConnectionId: 'saved-connection', serverId: 'saved-server',
      ...(environment ? { endpointId: environment.id } : {}),
    });
    expect(openAuthorization).toHaveBeenCalledExactlyOnceWith('https://vendor.example/authorize');
  });

  it('rejects a blank bearer credential before posting or reporting success', async () => {
    const post = vi.fn();
    const openAuthorization = vi.fn();
    await expect(requestConnection({ providerId: 'github', authKind: 'bearer', scopes: [], token: ' ' }, { post, openAuthorization })).rejects.toThrow('token is required');
    expect(post).not.toHaveBeenCalled();
  });

  it('requires a region from the user and ignores a region supplied in a conversation URL', async () => {
    const page = await ConnectPage({ searchParams: Promise.resolve({ provider: 'intercom', endpointId: 'eu', instanceUrl: 'https://forged.example' }) });
    expect(page.props.endpointConfig).toMatchObject({ kind: 'region', locked: false });
    expect(page.props.endpointConfig.selectedId).toBeUndefined();
    const html = renderToStaticMarkup(page);
    expect(html).toContain('Select workspace region');
    expect(html).toMatch(/<button[^>]*disabled=""/);
    const post = vi.fn(async () => ({ authorizationUrl: 'https://vendor.example/authorize' }));
    const openAuthorization = vi.fn();
    await expect(requestConnection(page.props, { post, openAuthorization })).rejects.toThrow('Choose workspace region');
    expect(post).not.toHaveBeenCalled();
    await requestConnection({ ...page.props, endpointId: 'eu' }, { post, openAuthorization });
    expect(post).toHaveBeenCalledExactlyOnceWith('/integrations/connect', { providerId: 'intercom', endpointId: 'eu', scopes: [], authConfigId: undefined, existingConnectionId: undefined });
  });

  it('pins reconnects to the saved region and offers a clear path to change it', async () => {
    savedServers.entries = [{ id: 'saved-intercom', providerId: 'intercom', url: 'https://mcp.eu.intercom.com/mcp', auth: { kind: 'oauth' }, enabled: true }];
    const page = await ConnectPage({ searchParams: Promise.resolve({ provider: 'intercom', endpointId: 'us' }) });
    expect(page.props.endpointConfig).toMatchObject({ kind: 'region', locked: true, selectedId: 'eu' });
    const html = renderToStaticMarkup(page);
    expect(html).toContain('Europe');
    expect(html).toContain('Disconnect to change this selection');
    expect(html).not.toContain('<select');
    const post = vi.fn(async () => ({ authorizationUrl: 'https://vendor.example/authorize' }));
    await requestConnection({ ...page.props, endpointId: 'us' }, { post, openAuthorization: vi.fn() });
    expect(post).toHaveBeenCalledWith('/integrations/connect', expect.objectContaining({ endpointId: 'eu' }));
  });

  it('requires a user-selected Smartsheet region instead of trusting a conversation URL', async () => {
    const page = await ConnectPage({ searchParams: Promise.resolve({ provider: 'smartsheet', endpointId: 'eu', instanceUrl: 'https://forged.example' }) });
    expect(page.props.endpointConfig).toMatchObject({ kind: 'region', locked: false });
    expect(page.props.endpointConfig.selectedId).toBeUndefined();
    const html = renderToStaticMarkup(page);
    expect(html).toContain('Select smartsheet region');
    expect(html).toContain('API token');
    expect(html).not.toContain('<option value="eu" selected="">');
    expect(html).not.toContain('forged.example');
    const post = vi.fn(async () => ({ connection: { id: 'hosted-smartsheet' } }));
    const openAuthorization = vi.fn();
    await expect(requestConnection({ ...page.props, token: 'fixture-token' }, { post, openAuthorization })).rejects.toThrow('Choose smartsheet region');
    expect(post).not.toHaveBeenCalled();
    await requestConnection({ ...page.props, token: 'fixture-token', endpointId: 'au' }, { post, openAuthorization });
    expect(post).toHaveBeenCalledExactlyOnceWith('/integrations/connectDirect', {
      providerId: 'smartsheet', fields: { token: 'fixture-token' }, endpointId: 'au',
    });
    expect(openAuthorization).not.toHaveBeenCalled();
  });

  it('pins a Smartsheet replacement token to its saved regional account', async () => {
    savedServers.entries = [{
      id: 'saved-smartsheet', providerId: 'smartsheet', connectionId: 'saved-smartsheet-connection',
      displayName: 'Europe account', url: 'https://mcp.smartsheet.eu', auth: { kind: 'bearer' }, enabled: true,
    }];
    const page = await ConnectPage({ searchParams: Promise.resolve({
      provider: 'smartsheet', connection: 'saved-smartsheet-connection', endpointId: 'us',
    }) });
    expect(page.props.endpointConfig).toMatchObject({ locked: true, selectedId: 'eu' });
    const html = renderToStaticMarkup(page);
    expect(html).toContain('Europe');
    expect(html).toContain('Disconnect to change this selection');
    expect(html).not.toContain('<select');
    const post = vi.fn(async () => ({ connection: { id: 'saved-smartsheet-connection' } }));
    const openAuthorization = vi.fn();
    await requestConnection({ ...page.props, endpointId: 'au', token: 'replacement-token' }, { post, openAuthorization });
    expect(post).toHaveBeenCalledExactlyOnceWith('/integrations/connectDirect', {
      providerId: 'smartsheet', fields: { token: 'replacement-token' }, endpointId: 'eu',
      serverId: 'saved-smartsheet', existingConnectionId: 'saved-smartsheet-connection',
    });
    expect(openAuthorization).not.toHaveBeenCalled();
  });

  it('requires an instance address and forwards it outside credentials', async () => {
    const page = await ConnectPage({ searchParams: Promise.resolve({ provider: 'n8n', instanceUrl: 'https://forged.example' }) });
    expect(page.props.endpointConfig).toMatchObject({ kind: 'instance', locked: false });
    const html = renderToStaticMarkup(page);
    expect(html).toContain('type="url"');
    expect(html).toContain('Setup guide');
    expect(html).toContain('https://docs.n8n.io/connect/connect-to-n8n-mcp-server');
    expect(html).toContain('Ask an instance owner or admin');
    expect(html).not.toContain('forged.example');
    const post = vi.fn(async () => ({ authorizationUrl: 'https://team.example/authorize' }));
    await expect(requestConnection(page.props, { post, openAuthorization: vi.fn() })).rejects.toThrow('Enter your instance url');
    expect(post).not.toHaveBeenCalled();
    await requestConnection({ ...page.props, instanceUrl: ' https://team.example ' }, { post, openAuthorization: vi.fn() });
    expect(post).toHaveBeenCalledExactlyOnceWith('/integrations/connect', { providerId: 'n8n', instanceUrl: 'https://team.example', scopes: [], authConfigId: undefined, existingConnectionId: undefined });
  });

  it('also forwards configured endpoint choices through a direct credential connection', async () => {
    const post = vi.fn(async () => ({ connection: { id: 'fixture' } }));
    const openAuthorization = vi.fn();
    await requestConnection({
      providerId: 'instance-fixture', authKind: 'bearer', scopes: [], token: 'fixture-token', instanceUrl: 'https://team.example',
      endpointConfig: { kind: 'instance', label: 'Instance URL', placeholder: '', locked: false },
    }, { post, openAuthorization });
    expect(post).toHaveBeenCalledExactlyOnceWith('/integrations/connectDirect', { providerId: 'instance-fixture', fields: { token: 'fixture-token' }, instanceUrl: 'https://team.example' });
    expect(openAuthorization).not.toHaveBeenCalled();
  });

  it('accepts an existing OAuth authorization but does not manufacture a successful connection response', async () => {
    const openAuthorization = vi.fn();
    expect(await requestConnection({ providerId: 'todoist', authKind: 'oauth', scopes: [] }, { post: async () => ({ requiresAuth: false }), openAuthorization })).toContain('Connected.');
    await expect(requestConnection({ providerId: 'github', authKind: 'bearer', scopes: [], token: 'fixture' }, { post: async () => ({}), openAuthorization })).rejects.toThrow('could not be verified');
    expect(openAuthorization).not.toHaveBeenCalled();
  });
});
