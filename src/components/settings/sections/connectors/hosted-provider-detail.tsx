'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConnectorLogo } from '@/components/connectors/connector-logo';
import { connectorMeta } from '@/components/connectors/connector-meta';
import { HostedEndpointFields } from '@/components/connectors/hosted-endpoint-fields';
import { connectorEndpointSelection, type HostedEndpointSelection } from '@/lib/client/connector-endpoint';
import { BackLink, Chip, ConnectFormSection, DetailHeader, GroupHeading } from './parts';
import { Byo, ConnectPanel, ToolList, type ProviderDetailProps } from './provider-detail';
import { CapabilityReview } from './capability-review';
import { providerForHostedAccount } from './hosted-account-request';
import { connectionIdentity, isRegisteredMcp, type Connection, type HostedMcpAccount, type HostedConnectIntent } from './types';

/** Account-scoped controls for built-in services, including unfinished sign-ins. */
export function HostedProviderDetail(props: ProviderDetailProps) {
  const { provider, connections, busy } = props;
  const accounts = provider.mcp?.accounts ?? [];
  const previousConnections = connections.filter(connection => !accounts.some(account => account.connectionId === connection.id));
  const [target, setTarget] = useState<string | null>(null);
  const ids = [...accounts.map(account => account.serverId), ...previousConnections.map(connection => `previous:${connection.id}`)].join(',');
  const [seenIds, setSeenIds] = useState(ids);
  if (seenIds !== ids) { setSeenIds(ids); setTarget(null); }
  const active = accounts.find(account => account.serverId === target);
  const previousActive = previousConnections.find(connection => `previous:${connection.id}` === target);
  const showForm = (accounts.length === 0 && previousConnections.length === 0) || target === 'new' || !!active || !!previousActive;
  const kind = provider.mcp?.authKind ?? 'oauth';
  const healthy = accounts.length > 0 && accounts.every(account => account.enabled !== false && !account.requiresAuth && account.status === 'ok');
  const usedAuthConfigIds = accounts.flatMap(account => account.authConfigId ? [account.authConfigId] : []);
  const toolCount = props.toolkits.reduce((count, toolkit) => count + toolkit.actions.length, 0);
  // With accounts, a button in their section opened the form, so it goes under that heading, above them.
  const hasAccounts = accounts.length > 0 || previousConnections.length > 0;
  const form = showForm && <ConnectFormSection opened={hasAccounts}>
    <GroupHeading action={hasAccounts && <Button size="xs" variant="ghost" disabled={busy} onClick={() => setTarget(null)}>Cancel</Button>}>
      {active ? `Reconnect ${active.label || provider.displayName}` : previousActive ? `Reconnect ${connectionIdentity(previousActive)}` : hasAccounts ? 'Add another account' : 'Connect'}
    </GroupHeading>
    <HostedAccountForm key={active?.serverId ?? previousActive?.id ?? 'new'} {...props} account={active} previousConnection={previousActive} usedAuthConfigIds={usedAuthConfigIds} />
  </ConnectFormSection>;

  return <div className="space-y-6">
    <div className="space-y-4">
      <BackLink onBack={props.onBack} busy={busy} />
      <DetailHeader logo={<ConnectorLogo providerId={provider.id} name={provider.displayName} size={48} />}
        title={provider.displayName} subtitle={connectorMeta(provider.id).description}
        meta={<><Chip tone={healthy ? 'ok' : accounts.length ? 'warn' : undefined}>{accounts.length ? healthy ? `${accounts.length} account${accounts.length === 1 ? '' : 's'} connected` : 'Needs attention' : 'Not connected'}</Chip><Chip>{connectorMeta(provider.id).category}</Chip>{toolCount > 0 && <Chip>{toolCount} tools</Chip>}</>} />
    </div>

    {(accounts.length > 0 || previousConnections.length > 0) && <section className="space-y-2">
      <GroupHeading count={accounts.length + previousConnections.length} action={kind !== 'none' && <Button size="xs" variant="outline" disabled={busy} onClick={() => setTarget('new')}><Plus size={12} /> Add account</Button>}>Accounts</GroupHeading>
      {form}
      <div className="space-y-3">{accounts.map(account => {
        const connection = connections.find(candidate => candidate.id === account.connectionId);
        const label = account.label || (connection && connectionIdentity(connection)) || provider.displayName;
        const result = connection ? props.testResults[connection.id] : undefined;
        return <div key={account.serverId} className="space-y-3 rounded-xl border border-border bg-card/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0"><p className="truncate text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground">{account.enabled === false ? 'Off' : account.requiresAuth ? kind === 'bearer' ? 'Token needed' : 'Sign-in needed' : account.status === 'ok' ? 'Connected' : 'Needs attention'}{account.toolCount !== undefined ? ` · ${account.toolCount} tools` : ''}</p>
            </div>
            <div className="flex flex-wrap gap-1">
              <Button size="xs" variant="ghost" disabled={busy} onClick={() => setTarget(account.serverId)}>{kind === 'bearer' ? 'Update token' : 'Reconnect'}</Button>
              {connection && <Button size="xs" variant="ghost" disabled={busy || props.testing === connection.id} onClick={() => props.onTest(connection.id)}>Test</Button>}
              {connection ? <Button size="xs" variant="ghost" disabled={busy} onClick={() => props.onDisconnect(connection.id)}>Disconnect</Button>
                : <Button size="xs" variant="ghost" disabled={busy} onClick={() => props.onCancelSetup?.(account.serverId)}>Cancel setup</Button>}
            </div>
          </div>
          {account.endpointConfig && <HostedEndpointFields setup={account.endpointConfig} disabled />}
          {account.authConfigId && <p className="text-xs text-muted-foreground">OAuth app: {props.byoConfigs.find(config => config.id === account.authConfigId)?.label ?? account.authConfigId}. Disconnect to change this app.</p>}
          {account.error && <p role="status" className="text-xs text-muted-foreground">{account.error}</p>}
          {result && <p role="status" className="text-xs text-muted-foreground">{result.ok ? 'Healthy' : result.error || result.status}</p>}
          {account.lastCheckedAt && <p className="text-[11px] text-muted-foreground">Last checked <time dateTime={account.lastCheckedAt} suppressHydrationWarning>{new Date(account.lastCheckedAt).toLocaleString()}</time></p>}
          <CapabilityReview changes={account.capabilityChanges} busy={busy} onReview={props.onReviewCapabilities ? revision => props.onReviewCapabilities!(account.serverId, revision) : undefined} />
        </div>;
      })}</div>
      {previousConnections.map(connection => <div key={connection.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card/20 p-3">
        <div className="min-w-0"><p className="truncate text-sm font-medium">{connectionIdentity(connection)}</p><p className="text-xs text-muted-foreground">Reconnect this saved account to use the current connector.</p></div>
        <div className="flex gap-1">
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => setTarget(`previous:${connection.id}`)}>Reconnect</Button>
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => props.onDisconnect(connection.id)}>Disconnect</Button>
        </div>
      </div>)}
    </section>}

    {!hasAccounts && form}

    {isRegisteredMcp(provider) && !showForm && <section className="space-y-2">
      <Button variant="ghost" size="xs" onClick={props.onToggleAdvanced} aria-expanded={props.advancedOpen}>OAuth apps</Button>
      {props.advancedOpen && <Byo {...props} provider={providerForHostedAccount(provider, { addAccount: true })} usedAuthConfigIds={usedAuthConfigIds} connectDisabled />}
    </section>}
    {toolCount > 0 && <ToolList toolkits={props.toolkits} writePolicy={props.writePolicy} onSetApproval={props.onSetApproval} />}
  </div>;
}

function HostedAccountForm(props: ProviderDetailProps & { account?: HostedMcpAccount; previousConnection?: Connection }) {
  const { account, previousConnection } = props;
  const [label, setLabel] = useState(account?.label ?? previousConnection?.label ?? '');
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [endpoint, setEndpoint] = useState<HostedEndpointSelection>({});
  const [setupId] = useState(() => crypto.randomUUID());
  const baseIntent: HostedConnectIntent = account
    ? { serverId: account.serverId, existingConnectionId: account.connectionId }
    : previousConnection ? { existingConnectionId: previousConnection.id }
      : props.provider.mcp?.authKind === 'none' ? {} : { addAccount: true, setupId };
  const provider = providerForHostedAccount(props.provider, baseIntent, props.connections);
  const needsLabel = !account && !previousConnection && provider.mcp?.authKind !== 'none';
  const ready = !needsLabel || !!label.trim();
  const intent = (): HostedConnectIntent => ({ ...baseIntent, label: label.trim() || undefined, fields: creds, ...connectorEndpointSelection(provider.mcp?.endpointConfig, endpoint) });
  const formProps: ProviderDetailProps = {
    ...props, provider, connections: props.connections.filter(connection => connection.id === (account?.connectionId ?? previousConnection?.id)),
    creds, endpointSelection: endpoint, connectDisabled: !ready,
    onCredChange: (field, value) => setCreds(previous => ({ ...previous, [field]: value })),
    onConnectOAuth: authConfigId => { if (ready) props.onConnectOAuth(authConfigId, intent()); },
    onConnectDirect: () => { if (ready) props.onConnectDirect(intent()); },
  };
  return <div className="space-y-4 rounded-xl border border-border bg-card/20 p-4">
    {needsLabel && <div className="space-y-1"><label htmlFor="hosted-account-label" className="text-xs font-medium">Account label</label><Input id="hosted-account-label" value={label} onChange={event => setLabel(event.target.value)} placeholder="Work or Personal" disabled={props.busy} required /></div>}
    {provider.mcp?.endpointConfig && <HostedEndpointFields setup={provider.mcp.endpointConfig} value={endpoint} onChange={setEndpoint} disabled={props.busy} />}
    <ConnectPanel {...formProps} />
    {isRegisteredMcp(provider) && provider.configured && <div className="space-y-2">
      <Button variant="ghost" size="xs" onClick={props.onToggleAdvanced} aria-expanded={props.advancedOpen}>OAuth apps</Button>
      {props.advancedOpen && <Byo {...formProps} />}
    </div>}
  </div>;
}
