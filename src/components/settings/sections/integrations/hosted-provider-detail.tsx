'use client';

import dynamic from 'next/dynamic';
import { PluginSetupHelpButton } from '@/components/plugins/setup-help-button';
import { INTEGRATION_LABELS } from '@/constants/integrations';
import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IntegrationLogo } from '@/components/integrations/integration-logo';
import { integrationMeta } from '@/components/integrations/integration-meta';
import { HostedEndpointFields } from '@/components/integrations/hosted-endpoint-fields';
import { integrationEndpointSelection, type HostedEndpointSelection } from '@/lib/client/integration-endpoint';
import { BackLink, Chip, ConnectFormSection, DetailHeader, GroupHeading } from './parts';
import { McpServerSettings } from './mcp-settings';
import { Byo, ConnectPanel, ToolList, type ProviderDetailProps } from './provider-detail';
import { CapabilityReview } from './capability-review';
import { providerForHostedAccount, providerForHostedDeployment } from './hosted-account-request';
import { SlackConnectionOptions } from './slack-connection-options';
import { SlackAppsSection } from './slack-apps-section';
import { SlackMcpAccessHelp } from './slack-mcp-access-help';
import { slackMcpAccessIssue } from '@/lib/integrations/slack-account-setup';
import { connectionIdentity, isRegisteredMcp, type Connection, type HostedMcpAccount, type HostedConnectIntent } from './types';

// What the server's screens may reach on the network, which the page asks the Home once it shows in the browser.
const McpAppNetwork = dynamic(() => import('./mcp-app-network').then(module => module.McpAppNetwork), { ssr: false });

/** Account-scoped controls for built-in services, including unfinished sign-ins. */
export function HostedProviderDetail(props: ProviderDetailProps) {
  const { provider, connections, busy } = props;
  const slack = provider.id === 'slack';
  const savedApp = slack && props.savedApp?.providerId === provider.id ? props.savedApp : undefined;
  const savedAppId = savedApp?.id;
  const [connectApp, setConnectApp] = useState(savedApp?.id);
  const [seenSavedApp, setSeenSavedApp] = useState(savedApp?.id);
  const signInRef = useRef<HTMLDivElement>(null);
  const accounts = provider.mcp?.accounts ?? [];
  const previousConnections = connections.filter(connection => !accounts.some(account => account.connectionId === connection.id));
  const [target, setTarget] = useState<string | null>(null);
  const ids = [...accounts.map(account => account.serverId), ...previousConnections.map(connection => `previous:${connection.id}`)].join(',');
  const [seenIds, setSeenIds] = useState(ids);
  if (seenIds !== ids) { setSeenIds(ids); setTarget(null); }
  if (savedApp && savedApp.id !== seenSavedApp) { setSeenSavedApp(savedApp.id); setConnectApp(savedApp.id); setTarget('new'); }
  useEffect(() => {
    if ((!savedAppId && target !== 'new') || !provider.configured || !slack) return;
    signInRef.current?.focus();
    signInRef.current?.scrollIntoView({block:'nearest'});
  }, [savedAppId, provider.configured, target, connectApp, slack]);
  const active = accounts.find(account => account.serverId === target);
  const previousActive = previousConnections.find(connection => `previous:${connection.id}` === target);
  const showForm = (accounts.length === 0 && previousConnections.length === 0) || target === 'new' || !!active || !!previousActive;
  const kind = provider.mcp?.authKind ?? 'oauth';
  const local = provider.mcp?.local === true;
  const healthy = accounts.length > 0 && accounts.every(account => account.enabled !== false && !account.requiresAuth && account.status === 'ok');
  const usedAuthConfigIds = accounts.flatMap(account => account.authConfigId ? [account.authConfigId] : []);
  const toolCount = props.toolkits.reduce((count, toolkit) => count + toolkit.actions.length, 0);
  // With accounts, a button in their section opened the form, so it goes under that heading, above them.
  const hasAccounts = accounts.length > 0 || previousConnections.length > 0;
  const form = showForm && (!slack || provider.configured) && <ConnectFormSection opened={hasAccounts}>
    <GroupHeading action={hasAccounts && <Button size="xs" variant="ghost" disabled={busy} onClick={() => setTarget(null)}>Cancel</Button>}>
      {active ? `Reconnect ${active.label || provider.displayName}` : previousActive ? `Reconnect ${connectionIdentity(previousActive)}` : hasAccounts ? 'Add another account' : 'Connect'}
    </GroupHeading>
    <div ref={signInRef} tabIndex={-1} id={slack ? 'slack-account-sign-in' : undefined} className="scroll-mt-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <HostedAccountForm key={active?.serverId ?? previousActive?.id ?? `new:${connectApp ?? ''}`} {...props} account={active} previousConnection={previousActive} usedAuthConfigIds={usedAuthConfigIds} initialAuthConfigId={connectApp} />
    </div>
  </ConnectFormSection>;

  return <div className="space-y-6">
    <div className="space-y-4">
      <BackLink onBack={props.onBack} busy={busy} />
      <DetailHeader logo={<IntegrationLogo providerId={provider.id} name={provider.displayName} size={48} />}
        title={provider.displayName} subtitle={integrationMeta(provider.id).description}
        meta={<><Chip tone={healthy ? 'ok' : accounts.length ? 'warn' : undefined}>{accounts.length ? healthy ? local ? 'Connected' : `${accounts.length} account${accounts.length === 1 ? '' : 's'} connected` : 'Needs attention' : 'Not connected'}</Chip><Chip>{integrationMeta(provider.id).category}</Chip>{toolCount > 0 && <Chip>{toolCount} tools</Chip>}</>} />
    </div>

    {provider.id === 'slack' && <SlackConnectionOptions disabled={busy} />}

    {slack && <SlackAppsSection {...props} onConnectApp={id => { setConnectApp(id); setTarget('new'); }} />}

    {!showForm && <PluginSetupHelpButton target={{ kind: 'integration', provider }} disabled={busy} />}

    {(accounts.length > 0 || previousConnections.length > 0) && <section className="space-y-2">
      <GroupHeading count={local ? undefined : accounts.length + previousConnections.length} action={kind !== 'none' && <Button size="xs" variant="outline" disabled={busy} onClick={() => setTarget('new')}><Plus size={12} /> Add account</Button>}>{local ? 'Connection' : 'Accounts'}</GroupHeading>
      {form}
      <div className="space-y-3">{accounts.map(account => {
        const accountKind = account.authKind ?? kind;
        const connection = connections.find(candidate => candidate.id === account.connectionId);
        const label = account.label || (connection && connectionIdentity(connection)) || provider.displayName;
        const result = connection ? props.testResults[connection.id] : undefined;
        const checking = !!connection && props.testing === connection.id;
        const problem = result?.ok === false ? result.error : account.error;
        const accessBlocked = slack && slackMcpAccessIssue(problem);
        return <div key={account.serverId} className="space-y-3 rounded-xl border border-border bg-card/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0"><p className="truncate text-sm font-medium">{label}</p>
              <p role={checking ? 'status' : undefined} className="text-xs text-muted-foreground">{checking ? slack ? 'Checking Slack access…' : 'Checking connection…' : accessBlocked ? 'Enable access in Slack' : account.enabled === false ? 'Off' : account.requiresAuth ? accountKind === 'bearer' ? 'Token needed' : 'Sign-in needed' : account.status === 'ok' ? 'Connected' : 'Needs attention'}{!checking && account.toolCount !== undefined ? ` · ${account.toolCount} tools` : ''}</p>
            </div>
            <div className="flex flex-wrap gap-1">
              <Button size="xs" variant="ghost" disabled={busy} onClick={() => setTarget(account.serverId)}>{accountKind === 'bearer' ? 'Update token' : 'Reconnect'}</Button>
              {connection && <Button size="xs" variant="ghost" disabled={busy || checking} onClick={() => props.onTest(connection.id)}>{checking && <Loader2 size={12} className="animate-spin" />}{checking ? 'Checking…' : slack ? 'Test connection' : 'Test'}</Button>}
              {!connection && accessBlocked && <Button size="xs" variant="outline" disabled={busy} onClick={() => props.onConnectOAuth(account.authConfigId, {serverId:account.serverId,label:account.label})}>Continue setup</Button>}
              {connection ? <Button size="xs" variant="ghost" disabled={busy} onClick={() => props.onDisconnect(connection.id)}>Disconnect</Button>
                : <Button size="xs" variant="ghost" disabled={busy} onClick={() => props.onCancelSetup?.(account.serverId)}>Cancel setup</Button>}
            </div>
          </div>
          {account.endpointConfig && <HostedEndpointFields setup={account.endpointConfig} disabled />}
          {account.authConfigId && <p className="text-xs text-muted-foreground">{slack ? 'Slack app' : 'OAuth app'}: {props.byoConfigs.find(config => config.id === account.authConfigId)?.label ?? account.authConfigId}. Disconnect to change this app.</p>}
          {accessBlocked && problem ? <SlackMcpAccessHelp error={problem} /> : <>
            {account.error && <p role="status" className="text-xs text-muted-foreground">{account.error}</p>}
            {result && <p role="status" className="text-xs text-muted-foreground">{result.ok ? slack ? 'Connected. Slack tools are ready.' : 'Healthy' : result.error || result.status}</p>}
          </>}
          {account.lastCheckedAt && <p className="text-[11px] text-muted-foreground">Last checked <time dateTime={account.lastCheckedAt} suppressHydrationWarning>{new Date(account.lastCheckedAt).toLocaleString()}</time></p>}
          <CapabilityReview changes={account.capabilityChanges} busy={busy} onReview={props.onReviewCapabilities ? revision => props.onReviewCapabilities!(account.serverId, revision) : undefined} />
          <McpServerSettings serverId={account.serverId} name={label} enabled={!!account.settings && !!connection && account.enabled !== false && !account.requiresAuth && account.status === 'ok'} />
          <McpAppNetwork serverId={account.serverId} name={label} enabled={!!connection && account.enabled !== false && !account.requiresAuth && account.status === 'ok'} />
        </div>;
      })}</div>
      {previousConnections.map(connection => <div key={connection.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card/20 p-3">
        <div className="min-w-0"><p className="truncate text-sm font-medium">{connectionIdentity(connection)}</p><p className="text-xs text-muted-foreground">Reconnect this saved account to use the current {INTEGRATION_LABELS.singular.toLowerCase()}.</p></div>
        <div className="flex gap-1">
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => setTarget(`previous:${connection.id}`)}>Reconnect</Button>
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => props.onDisconnect(connection.id)}>Disconnect</Button>
        </div>
      </div>)}
    </section>}

    {!hasAccounts && form}

    {isRegisteredMcp(provider) && !slack && !showForm && <section className="space-y-2">
      <Button variant="ghost" size="xs" onClick={props.onToggleAdvanced} aria-expanded={props.advancedOpen}>OAuth apps</Button>
      {props.advancedOpen && <Byo {...props} provider={providerForHostedAccount(provider, { addAccount: true })} usedAuthConfigIds={usedAuthConfigIds} connectDisabled />}
    </section>}
    {toolCount > 0 && <ToolList toolkits={props.toolkits} writePolicy={props.writePolicy} onSetApproval={props.onSetApproval} />}
  </div>;
}

function HostedAccountForm(props: ProviderDetailProps & { account?: HostedMcpAccount; previousConnection?: Connection; initialAuthConfigId?: string }) {
  const { account, previousConnection } = props;
  const [label, setLabel] = useState(account?.label ?? previousConnection?.label ?? '');
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [endpoint, setEndpoint] = useState<HostedEndpointSelection>({});
  const [setupId] = useState(() => crypto.randomUUID());
  const appSelectId = useId();
  const slack = props.provider.id === 'slack';
  const [authConfigId, setAuthConfigId] = useState(props.initialAuthConfigId ?? props.byoConfigs.find(config => config.isDefault)?.id ?? (props.byoConfigs.length === 1 ? props.byoConfigs[0].id : ''));
  const baseIntent: HostedConnectIntent = account
    ? { serverId: account.serverId, existingConnectionId: account.connectionId }
    : previousConnection ? { existingConnectionId: previousConnection.id }
      : props.provider.mcp?.authKind === 'none' ? {} : { addAccount: true, setupId };
  const baseProvider = providerForHostedAccount(props.provider, baseIntent, props.connections);
  const [method, setMethod] = useState(account?.authKind ?? baseProvider.mcp?.authKind ?? 'oauth');
  const deployedProvider = providerForHostedDeployment(baseProvider, endpoint);
  const tokenAuth = deployedProvider.mcp?.tokenAuth;
  const provider = method === 'bearer' && tokenAuth
    ? { ...deployedProvider, mcp: { ...deployedProvider.mcp!, authKind: 'bearer' as const, credentialLabel: tokenAuth.label, helpUrl: tokenAuth.helpUrl } }
    : deployedProvider;
  const needsLabel = !account && !previousConnection && (provider.mcp?.authKind !== 'none' || provider.mcp?.endpointConfig?.kind === 'deployment');
  // Slack's app credentials come first. Ask for an account name when sign-in is available.
  const showLabel = needsLabel && (provider.id !== 'slack' || provider.configured);
  const chooseApp = slack && !account?.authConfigId;
  const ready = (!needsLabel || !!label.trim()) && (!chooseApp || props.byoConfigs.some(config => config.id === authConfigId && config.status === 'active'));
  const intent = (): HostedConnectIntent => ({ ...baseIntent, label: label.trim() || undefined, fields: creds, ...integrationEndpointSelection(provider.mcp?.endpointConfig, endpoint) });
  const formProps: ProviderDetailProps = {
    ...props, provider, connections: props.connections.filter(connection => connection.id === (account?.connectionId ?? previousConnection?.id)),
    creds, endpointSelection: endpoint, connectDisabled: props.connectDisabled || !ready,
    onCredChange: (field, value) => setCreds(previous => ({ ...previous, [field]: value })),
    onConnectOAuth: selected => { if (ready) props.onConnectOAuth(selected ?? (chooseApp ? authConfigId : undefined), intent()); },
    onConnectDirect: () => { if (ready) props.onConnectDirect(intent()); },
  };
  return <div className="space-y-4 rounded-xl border border-border bg-card/20 p-4">
    {tokenAuth && !account && !previousConnection && <div className="flex gap-2" aria-label="Connection method">
      <Button type="button" size="xs" variant={method === 'oauth' ? 'secondary' : 'ghost'} disabled={props.busy} onClick={() => { setMethod('oauth'); setCreds({}); }}>Sign in</Button>
      <Button type="button" size="xs" variant={method === 'bearer' ? 'secondary' : 'ghost'} disabled={props.busy} onClick={() => { setMethod('bearer'); setCreds({}); }}>Use API key</Button>
    </div>}
    {chooseApp && props.provider.configured && <div className="space-y-1"><label htmlFor={appSelectId} className="text-xs font-medium">Slack app</label><select id={appSelectId} value={authConfigId} onChange={event => setAuthConfigId(event.target.value)} disabled={props.busy} className="w-full rounded-md border border-border bg-background p-2 text-sm"><option value="">Choose a Slack app</option>{props.byoConfigs.filter(config => config.status === 'active').map(config => <option key={config.id} value={config.id}>{config.label ?? config.id}</option>)}</select></div>}
    {showLabel && <div className="space-y-1"><label htmlFor="hosted-account-label" className="text-xs font-medium">Account label</label><Input id="hosted-account-label" value={label} onChange={event => setLabel(event.target.value)} placeholder="Work or Personal" disabled={props.busy} required /></div>}
    {provider.mcp?.endpointConfig && <HostedEndpointFields setup={provider.mcp.endpointConfig} value={endpoint} onChange={selection => { setEndpoint(selection); setMethod('oauth'); setCreds({}); }} disabled={props.busy} />}
    <ConnectPanel {...formProps} />
    {isRegisteredMcp(provider) && provider.configured && !slack && <div className="space-y-2">
      <Button variant="ghost" size="xs" onClick={props.onToggleAdvanced} aria-expanded={props.advancedOpen}>OAuth apps</Button>
      {props.advancedOpen && <Byo {...formProps} />}
    </div>}
  </div>;
}
