import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { getHostedMcpProvider, HOSTED_MCP_PROVIDERS } from '@integrations/engine/providers';
import { hostedMcpEndpointSetup } from '@/lib/integrations/hosted-endpoint';
import { ProviderDetail, type ProviderDetailProps } from './provider-detail';
import { PreviousConnections } from './previous-connections';
import type { Connection, ProviderStatus } from './types';

const provider: ProviderStatus = {
  id: 'todoist',
  displayName: 'Todoist',
  method: 'mcp',
  configured: true,
  mcp: { requiresAuth: true },
};

const connection: Connection = {
  id: 'existing-connection',
  providerId: 'todoist',
  accountId: 'existing-account',
  label: 'Personal',
  scopes: [],
  status: 'needs_reauth',
};

function render(overrides: Partial<ProviderDetailProps> = {}) {
  const props: ProviderDetailProps = {
    provider,
    connections: [],
    toolkits: [],
    writePolicy: {},
    busy: false,
    testing: null,
    testResults: {},
    creds: {},
    selectedServices: [],
    advancedOpen: false,
    redirectUri: '',
    copied: false,
    byoConfigs: [],
    byoForm: { label: '', clientId: '', clientSecret: '' },
    onBack: vi.fn(),
    onConnectOAuth: vi.fn(),
    onConnectDirect: vi.fn(),
    onCredChange: vi.fn(),
    onToggleService: vi.fn(),
    onTest: vi.fn(),
    onDisconnect: vi.fn(),
    onSetApproval: vi.fn(),
    onToggleAdvanced: vi.fn(),
    onCopyRedirect: vi.fn(),
    onByoField: vi.fn(),
    onByoAdd: vi.fn(),
    onByoSetDefault: vi.fn(),
    onByoDelete: vi.fn(),
    ...overrides,
  };
  return renderToStaticMarkup(createElement(ProviderDetail, props));
}

function catalogProvider(id: string, configured = true): ProviderStatus & { mcp: NonNullable<ProviderStatus['mcp']> } {
  const definition = getHostedMcpProvider(id);
  if (!definition) throw new Error(`Missing catalog provider ${id}`);
  return {
    id, displayName: definition.displayName, method: 'mcp', configured,
    mcp: {
      requiresAuth: true, authKind: definition.auth?.kind ?? 'oauth',
      ...(definition.auth?.kind === 'oauth' ? { oauthRegistration: definition.auth.registration } : {}),
      endpointConfig: hostedMcpEndpointSetup(definition),
    },
  };
}

describe('hosted provider connection flow', () => {
  it('requires an explicit account label before starting the first hosted sign-in', () => {
    const html = render({ provider: { ...provider, mcp: { requiresAuth: true, authKind: 'oauth', accounts: [] } } });
    expect(html).toContain('Account label');
    expect(html).toContain('placeholder="Work or Personal"');
    expect(html).toMatch(/<button(?=[^>]*disabled="")[^>]*>[^]*?Connect Todoist/);
  });

  it('shows each account identity, health, region, and pinned app separately', () => {
    const region = { kind: 'region' as const, label: 'Region', locked: true, options: [{ id: 'us', label: 'United States' }, { id: 'eu', label: 'Europe' }] };
    const html = render({ provider: { ...provider, mcp: {
      requiresAuth: false, oauthRegistration: 'registered', accounts: [
        { serverId: 'us', connectionId: 'us-connection', label: 'US team', requiresAuth: false, status: 'ok', authConfigId: 'us-app', endpointConfig: { ...region, selectedId: 'us' } },
        { serverId: 'eu', connectionId: 'eu-connection', label: 'EU team', requiresAuth: true, status: 'error', error: 'Sign in again for this account', authConfigId: 'eu-app', endpointConfig: { ...region, selectedId: 'eu' } },
      ],
    } }, connections: [{ ...connection, id: 'us-connection', status: 'active' }, { ...connection, id: 'eu-connection' }], byoConfigs: [
      { id: 'us-app', providerId: 'todoist', label: 'US app', status: 'active', isDefault: true },
      { id: 'eu-app', providerId: 'todoist', label: 'EU app', status: 'active', isDefault: false },
    ] });
    for (const text of ['US team', 'EU team', 'United States', 'Europe', 'OAuth app: US app.', 'OAuth app: EU app.', 'Sign in again for this account', 'Add account', 'Needs attention']) expect(html).toContain(text);
    expect(html.match(/>Disconnect<\/button>/g)).toHaveLength(2);
    expect(html.match(/>Test<\/button>/g)).toHaveLength(2);
    expect(html.match(/>Reconnect<\/button>/g)).toHaveLength(2);
    expect(html).not.toContain('Choose a region');
  });

  it('keeps unfinished accounts visible with cancellation and their own tool review', () => {
    const html = render({ provider: { ...provider, mcp: { requiresAuth: false, accounts: [
      { serverId: 'healthy', connectionId: 'healthy-connection', label: 'Personal', requiresAuth: false, status: 'ok' },
      { serverId: 'pending', label: 'Work', requiresAuth: true, capabilityChanges: { revision: 'current', added: ['new-tool'], removed: ['old-tool'], changed: [{ name: 'update-task', fields: ['inputSchema', 'annotations'] }] } },
    ] } }, connections: [{ ...connection, id: 'healthy-connection', status: 'active' }], onCancelSetup: vi.fn(), onReviewCapabilities: vi.fn() });
    expect(html).toContain('Cancel setup');
    expect(html).toContain('Tools changed since your last review');
    expect(html).toContain('new-tool');
    expect(html).toContain('old-tool');
    expect(html).toContain('inputs, permissions and behavior');
    expect(html).toContain('Mark reviewed');
    expect(html.match(/>Disconnect<\/button>/g)).toHaveLength(1);
  });

  it('offers labeled bearer accounts while keeping public integrations free of account labels', () => {
    const bearer = render({ provider: { ...provider, mcp: { requiresAuth: true, authKind: 'bearer', accounts: [{ serverId: 'token', connectionId: connection.id, label: 'Work token', requiresAuth: false, status: 'ok' }] } }, connections: [connection] });
    expect(bearer).toContain('Work token');
    expect(bearer).toContain('Update token');
    expect(bearer).toContain('Add account');
    const publicHtml = render({ provider: { ...provider, mcp: { requiresAuth: false, authKind: 'none', accounts: [] } } });
    expect(publicHtml).not.toContain('Account label');
    expect(publicHtml).not.toContain('Add account');
    expect(publicHtml).toContain('does not require an account or a token');
  });

  it('keeps legacy saved accounts visible for explicit reconnect or removal', () => {
    const html = render({ provider: { ...provider, mcp: { requiresAuth: true, accounts: [] } }, connections: [connection] });
    expect(html).toContain('Personal');
    expect(html).toContain('Reconnect this saved account to use the current connector.');
    expect(html).toContain('>Reconnect</button>');
    expect(html).toContain('>Disconnect</button>');
    expect(html).toContain('Add account');
    expect(html).not.toContain('Account label');
  });

  it('uses connection IDs when different apps share the same remote account identity', () => {
    const html = render({ provider: { ...provider, mcp: { requiresAuth: false, accounts: [
      { serverId: 'first-server', connectionId: 'first-connection', accountId: 'shared-remote-account', label: 'First app', requiresAuth: false, status: 'ok' },
      { serverId: 'second-server', connectionId: 'second-connection', accountId: 'shared-remote-account', label: 'Second app', requiresAuth: false, status: 'ok' },
    ] } }, connections: [
      { ...connection, id: 'first-connection', accountId: 'shared-remote-account', label: 'First app' },
      { ...connection, id: 'second-connection', accountId: 'shared-remote-account', label: 'Second app' },
      { ...connection, id: 'legacy-connection', accountId: 'shared-remote-account', label: 'Previous app' },
    ], testResults: {
      'first-connection': { ok: false, status: 'error', error: 'First connection result' },
      'second-connection': { ok: false, status: 'error', error: 'Second connection result' },
    } });
    expect(html).toContain('Previous app');
    expect(html).toContain('Reconnect this saved account');
    expect(html.match(/First connection result/g)).toHaveLength(1);
    expect(html.match(/Second connection result/g)).toHaveLength(1);
    expect(html.match(/>Disconnect<\/button>/g)).toHaveLength(3);
    expect(html.match(/>Test<\/button>/g)).toHaveLength(2);
  });

  it.each(HOSTED_MCP_PROVIDERS.filter((entry) => !entry.auth || (entry.auth.kind === 'oauth' && entry.auth.registration !== 'registered')).map(({ id, displayName }) => [id, displayName]))('offers browser sign-in for %s without client registration', (id, displayName) => {
    const html = render({ provider: { ...provider, id, displayName, mcp: { authKind: 'oauth', requiresAuth: true } } });
    expect(html).toContain(`Connect ${displayName}`);
    expect(html).toContain(`Opens ${displayName} to approve access`);
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('Client ID');
    expect(html).not.toContain('Server URL');
  });

  it.each(HOSTED_MCP_PROVIDERS.filter((entry) => entry.auth?.kind === 'none').map(({ id, displayName }) => [id, displayName]))('offers a public connection for catalog service %s without account setup', (id, displayName) => {
    const html = render({ provider: { ...provider, id, displayName, mcp: { authKind: 'none', requiresAuth: false } } });
    expect(html).toContain(`Connect ${displayName}`);
    expect(html).toContain('does not require an account or a token');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('approve access');
    expect(html).not.toContain('Client ID');
    expect(html).not.toContain('Server URL');
    expect(html).not.toContain('OAuth app');
  });

  it.each(HOSTED_MCP_PROVIDERS.flatMap(({ id, displayName, auth }) => auth?.kind === 'bearer'
    ? [{ id, displayName, credentialLabel: auth.label ?? 'Connection token', helpUrl: auth.helpUrl }] : [],
  ))('offers an encrypted token form for $id without a server URL or OAuth button', ({ id, displayName, credentialLabel, helpUrl }) => {
    const html = render({ provider: { ...provider, id, displayName, mcp: { authKind: 'bearer', credentialLabel, helpUrl, requiresAuth: true } } });
    expect(html).toContain(credentialLabel);
    expect(html).toContain('type="password"');
    expect(html).toContain(`Connect ${displayName}`);
    if (helpUrl) expect(html).toContain(helpUrl);
    expect(html).toContain('stored encrypted');
    expect(html).not.toContain(`Opens ${displayName} to approve access`);
    expect(html).not.toContain('Server URL');
    expect(html).not.toContain('OAuth app');
  });

  it('offers token replacement when a bearer connection needs reauthorization', () => {
    const html = render({
      provider: { ...provider, id: 'github', displayName: 'GitHub', mcp: { authKind: 'bearer', requiresAuth: true } },
      connections: [{ ...connection, providerId: 'github' }],
    });
    expect(html).toContain('Token needed');
    expect(html).toContain('Update token');
    expect(html).not.toContain('Sign in to reconnect');
    expect(html).not.toContain('Add account');
  });

  it('offers a one-click public connection with no credentials', () => {
    const html = render({ provider: { ...provider, id: 'public-fixture', displayName: 'Public service', mcp: { authKind: 'none', requiresAuth: false } } });
    expect(html).toContain('Connect Public service');
    expect(html).toContain('does not require an account or a token');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('approve access');
    expect(html).not.toContain('OAuth app');
  });
  it('connects Todoist through browser sign-in with no token or server setup', () => {
    const html = render();
    expect(html).toContain('Connect Todoist');
    expect(html).toContain('Opens Todoist to approve access');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('API token');
    expect(html).not.toContain('OAuth app');
    expect(html).not.toContain('Server URL');
  });

  it('offers sign-in for an existing token connection while preserving its identity', () => {
    const html = render({ provider: { ...provider, mcp: undefined }, connections: [connection] });
    expect(html).toContain('Personal');
    expect(html).toContain('Sign-in needed');
    expect(html).toContain('Sign in to reconnect');
    expect(html).toContain('Your agent selections stay in place.');
    expect(html).not.toContain('Add account');
    expect(html).not.toContain('Sign in to another account');
  });

  it('keeps test, reconnect, disconnect, and remote tool permissions available after sign-in', () => {
    const html = render({
      provider: { ...provider, mcp: { serverId: 'hosted-todoist', status: 'ok', requiresAuth: false } },
      connections: [{ ...connection, status: 'active' }],
      toolkits: [{
        id: 'todoist',
        providerId: 'todoist',
        displayName: 'Todoist',
        scopes: [],
        actions: [
          { id: 'todoist.find-tasks', description: 'Find tasks', mutating: false, risk: 'low', scopes: [] },
          { id: 'todoist.manage-assignments', description: 'Assign tasks', mutating: true, risk: 'medium', scopes: [] },
        ],
      }],
      writePolicy: { 'todoist.manage-assignments': { mode: 'ask', defaultMode: 'auto', overridden: true } },
    });
    expect(html).toContain('>Connected<');
    expect(html).toContain('Reconnect');
    expect(html).toContain('Test');
    expect(html).toContain('Disconnect');
    expect(html).toContain('todoist.find-tasks');
    expect(html).toContain('aria-label="Ask before todoist.manage-assignments runs"');
    expect(html).not.toContain('Add account');
    expect(html).not.toContain('Sign in to reconnect');
  });

  it('requires an explicit region before enabling browser sign-in', () => {
    const configured: ProviderStatus = {
      ...provider, id: 'intercom', displayName: 'Intercom', mcp: { requiresAuth: true, endpointConfig: {
        kind: 'region', label: 'Workspace region', locked: false,
        options: [{ id: 'us', label: 'United States' }, { id: 'eu', label: 'Europe' }],
      } },
    };
    const empty = render({ provider: configured });
    expect(empty).toContain('<option value="" disabled="" selected="">Select workspace region</option>');
    expect(empty).toMatch(/<button[^>]*disabled=""[^>]*>.*?Connect Intercom/);
    const selected = render({ provider: configured, endpointSelection: { endpointId: 'eu' } });
    expect(selected).toContain('<option value="eu" selected="">Europe</option>');
    expect(selected).not.toMatch(/<button[^>]*disabled=""[^>]*>.*?Connect Intercom/);
  });

  it.each([
    { id: 'paypal', name: 'PayPal', testId: 'sandbox', testLabel: 'Sandbox' },
    { id: 'docusign', name: 'Docusign', testId: 'demo', testLabel: 'Developer demo' },
  ])('requires an explicit production or test environment for $name', ({ id, name, testId, testLabel }) => {
    const configured = catalogProvider(id);
    const empty = render({ provider: configured });
    expect(empty).toContain(`<option value="" disabled="" selected="">Select ${id} environment</option>`);
    expect(empty).toContain('<option value="production">Production</option>');
    expect(empty).toContain(`<option value="${testId}">${testLabel}</option>`);
    expect(empty).not.toMatch(/region/i);
    expect(empty).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>[^]*?Connect ${name}`));

    const selected = render({ provider: configured, endpointSelection: { endpointId: testId } });
    expect(selected).toContain(`<option value="${testId}" selected="">${testLabel}</option>`);
    expect(selected).not.toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>[^]*?Connect ${name}`));

    const accountForm = render({ provider: { ...configured, mcp: { ...configured.mcp, accounts: [] } } });
    expect(accountForm).toContain('Account label');
    expect(accountForm).toContain(`<option value="" disabled="" selected="">Select ${id} environment</option>`);
    expect(accountForm).not.toContain('<option value="production" selected="">');
    expect(accountForm).not.toMatch(/region/i);
  });

  it('shows Robinhood Agentic onboarding and PostHog project setup in the account form', () => {
    for (const [id, helpUrl, steps] of [
      ['robinhood', 'https://robinhood.com/us/en/support/articles/agentic-trading-overview/', [
        'desktop browser', 'primary Robinhood individual investing account in good standing',
        'Agentic account onboarding', 'Trading is limited to your Agentic account',
      ]],
      ['posthog', 'https://posthog.com/docs/model-context-protocol', [
        'organizations and projects', 'US or European region during sign-in',
        'organization AI processing', 'PostHog AI charges',
      ]],
    ] as const) {
      const configured = catalogProvider(id);
      const html = render({ provider: { ...configured, mcp: { ...configured.mcp, accounts: [] } } });
      expect(html).toContain('Setup guide');
      expect(html).toContain(`href="${helpUrl}"`);
      for (const step of steps) expect(html).toContain(step);
      expect(html).toContain(`Connect ${configured.displayName}`);
      expect(html).not.toContain('Client ID');
      expect(html).not.toContain('type="password"');
      expect(html).not.toContain('<select');
    }
  });

  it('requires a Smartsheet region and token with clear plan and account setup instructions', () => {
    const configured = catalogProvider('smartsheet');
    const empty = render({ provider: { ...configured, mcp: { ...configured.mcp, accounts: [] } } });
    expect(empty).toContain('Account label');
    expect(empty).toContain('Select smartsheet region');
    for (const region of ['United States', 'Europe', 'Australia']) expect(empty).toContain(region);
    expect(empty).toContain('Business, Enterprise or Advanced Work Management');
    expect(empty).toContain('Each regional account connects separately');
    expect(empty).toContain('API token');
    expect(empty).toContain('type="password"');
    expect(empty).not.toContain('approve access');
    expect(empty).not.toContain('Client ID');

    const withoutRegion = render({ provider: configured, creds: { token: 'fixture-token' } });
    expect(withoutRegion).toMatch(/<button[^>]*disabled=""[^>]*>[^]*?Connect Smartsheet/);
    const withoutToken = render({ provider: configured, endpointSelection: { endpointId: 'eu' } });
    expect(withoutToken).toMatch(/<button[^>]*disabled=""[^>]*>[^]*?Connect Smartsheet/);
    const ready = render({ provider: configured, creds: { token: 'fixture-token' }, endpointSelection: { endpointId: 'eu' } });
    expect(ready).toContain('<option value="eu" selected="">Europe</option>');
    expect(ready).not.toMatch(/<button[^>]*disabled=""[^>]*>[^]*?Connect Smartsheet/);
  });

  it.each([
    { clientId: '', clientSecret: 'fixture-secret', callback: true, ready: false },
    { clientId: 'fixture-integration-key', clientSecret: '', callback: true, ready: false },
    { clientId: 'fixture-integration-key', clientSecret: 'fixture-secret', callback: false, ready: false },
    { clientId: 'fixture-integration-key', clientSecret: 'fixture-secret', callback: true, ready: true },
  ])('requires Docusign integration credentials and a callback before adding its app: $ready', ({ clientId, clientSecret, callback, ready }) => {
    const unconfigured = catalogProvider('docusign', false);
    const redirectUri = callback ? 'https://app.example/api/integrations/mcp-oauth/builtin_docusign' : '';
    const html = render({
      provider: { ...unconfigured, mcp: { ...unconfigured.mcp, accounts: [], redirectUri } },
      byoForm: { label: 'Developer app', clientId, clientSecret },
    });
    expect(html).toContain('Docusign connects through an OAuth app you register yourself');
    expect(html).toContain('placeholder="Client ID"');
    expect(html).toMatch(/<input(?=[^>]*type="password")(?=[^>]*required="")(?=[^>]*placeholder="Client secret")[^>]*>/);
    expect(html).toContain('integration key and secret');
    expect(html).toContain('production-enabled integration');
    expect(html).toContain('https://developers.docusign.com/platform/mcp-server/');
    if (callback) expect(html).toContain(redirectUri);
    else expect(html).toContain('Callback address unavailable');
    const addButton = html.match(/<button\b[^>]*>(?:(?!<\/button>)[^])*Add app<\/button>/)?.[0];
    expect(addButton).toBeDefined();
    expect(addButton!.includes('disabled=""')).toBe(!ready);
    expect(html).not.toContain('Opens Docusign to approve access');
  });

  it('shows app registration as the connect flow for an unconfigured hosted provider', () => {
    const html = render({ provider: { ...provider, configured: false, mcp: { requiresAuth: true, oauthRegistration: 'registered', redirectUri: 'https://app.example/api/integrations/mcp-oauth/builtin_todoist' } } });
    expect(html).toContain('connects through an OAuth app you register yourself');
    expect(html).toContain('Client ID');
    expect(html).toContain('Add app');
    expect(html).toContain('https://app.example/api/integrations/mcp-oauth/builtin_todoist');
    expect(html).not.toContain('Opens Todoist to approve access');
  });

  it('shows registered app management after configuration without changing dynamic integration setup', () => {
    const html = render({
      provider: { ...provider, mcp: { requiresAuth: false, oauthRegistration: 'registered', authConfigId: 'saved-app', redirectUri: 'https://app.example/api/integrations/mcp-oauth/builtin_todoist' } },
      connections: [{ ...connection, status: 'active' }], advancedOpen: true,
      byoConfigs: [{ id: 'saved-app', providerId: 'todoist', label: 'Team', isDefault: true, status: 'active' }],
    });
    expect(html).toContain('OAuth apps');
    expect(html).toContain('OAuth app: Team. Disconnect to change this app.');
    expect(html).toContain('Client ID');
    expect(render()).not.toContain('OAuth apps');
  });

  it('lets a failed first registered sign-in cancel its saved client binding', () => {
    const html = render({
      provider: { ...provider, mcp: { serverId: 'pending-server', requiresAuth: true, oauthRegistration: 'registered', authConfigId: 'saved-app', redirectUri: 'https://app.example/callback' } },
      onCancelSetup: vi.fn(),
    });
    expect(html).toContain('Cancel setup');
    expect(html).toContain('Disconnect to change this app');
  });

  it('keeps a connected region visible and immutable while preserving reconnect and disconnect', () => {
    const html = render({
      provider: { ...provider, id: 'intercom', displayName: 'Intercom', mcp: { requiresAuth: false, status: 'ok', endpointConfig: {
        kind: 'region', label: 'Workspace region', locked: true, selectedId: 'eu',
        options: [{ id: 'us', label: 'United States' }, { id: 'eu', label: 'Europe' }],
      } } },
      connections: [{ ...connection, providerId: 'intercom', status: 'active' }],
      endpointSelection: { endpointId: 'us' },
    });
    expect(html).toContain('Europe');
    expect(html).not.toContain('United States');
    expect(html).not.toContain('<select');
    expect(html).toContain('Disconnect to change this selection');
    expect(html).toContain('Reconnect');
    expect(html).toContain('Disconnect');
  });

  it('lets a cancelled first sign-in discard its locked setup without a derived account', () => {
    const html = render({
      provider: { ...provider, id: 'n8n', displayName: 'n8n', mcp: { serverId: 'pending-server', requiresAuth: true, endpointConfig: {
        kind: 'instance', label: 'Instance URL', locked: true, selectedUrl: 'https://team.example/mcp-server/http', placeholder: 'https://team.example',
      } } },
      onCancelSetup: vi.fn(),
    });
    expect(html).toContain('https://team.example/mcp-server/http');
    expect(html).toContain('Cancel setup');
    expect(html).not.toContain('type="url"');
  });

  it('asks for an instance address without a token form for n8n', () => {
    const html = render({ provider: { ...provider, id: 'n8n', displayName: 'n8n', mcp: { requiresAuth: true, endpointConfig: {
      kind: 'instance', label: 'Instance URL', locked: false, placeholder: 'https://your-instance.app.n8n.cloud',
    } } } });
    expect(html).toContain('type="url"');
    expect(html).toContain('https://your-instance.app.n8n.cloud');
    expect(html).toContain('Setup guide');
    expect(html).toContain('https://docs.n8n.io/connect/connect-to-n8n-mcp-server');
    expect(html).toContain('Ask an instance owner or admin');
    expect(html).not.toContain('type="password"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Connect n8n/);
  });

  it('keeps retired Jira and Confluence accounts reviewable without obsolete sign-in actions', () => {
    const html = renderToStaticMarkup(createElement(PreviousConnections, {
      connections: [{ ...connection, providerId: 'jira', label: 'Jira work' }, { ...connection, id: 'second', providerId: 'confluence', label: 'Wiki work' }],
      busy: false, onDisconnect: vi.fn(),
    }));
    expect(html).toContain('Previous connections');
    expect(html).toContain('Connect Atlassian to use Jira and Confluence.');
    expect(html).toContain('Jira work');
    expect(html).toContain('Wiki work');
    expect(html.match(/>Disconnect</g)).toHaveLength(2);
    expect(html).not.toContain('Reconnect');
    expect(html).not.toContain('Sign in');
  });

  it('shows a temporary service failure without requesting another sign-in', () => {
    const html = render({
      provider: { ...provider, mcp: { status: 'unreachable', requiresAuth: false, error: 'Service unavailable.' } },
      connections: [{ ...connection, status: 'active' }],
    });
    expect(html).toContain('Needs attention');
    expect(html).toContain('Service unavailable.');
    expect(html).not.toContain('Sign-in needed');
    expect(html).not.toContain('Sign in to reconnect');
  });
});
