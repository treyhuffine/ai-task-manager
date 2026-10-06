'use client';
import { trpcClient } from '@/lib/trpc/client';

import { integrationMeta } from '@/components/integrations/integration-meta';
import { HostedEndpointFields } from '@/components/integrations/hosted-endpoint-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiErrorText } from '@/lib/api/client';
import { integrationEndpointReady, type HostedEndpointSelection } from '@/lib/client/integration-endpoint';
import { openIntegrationAuthorization } from '@/lib/client/desktop';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { requestConnection, selectRequestAccount, type ConnectionRequestOptions } from './request-connection';

export interface ConnectionRequestProps extends Omit<ConnectionRequestOptions, 'token'> {
  displayName: string;
  credentialLabel?: string;
  helpUrl?: string;
  redirectUri?: string;
}

export function ConnectionRequest(props: ConnectionRequestProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [token, setToken] = useState('');
  const [endpointSelection, setEndpointSelection] = useState<HostedEndpointSelection>({});
  const [selectedAccountId, setSelectedAccountId] = useState(props.existingConnectionId ?? (props.accounts?.length === 1 ? props.accounts[0].connectionId : ''));
  const needsAccountChoice = (props.accounts?.length ?? 0) > 1 && !selectedAccountId;
  let options = props;
  try { options = { ...props, ...selectRequestAccount(props, selectedAccountId || undefined) }; } catch { /* The form requires an explicit account below. */ }
  const bearer = props.authKind === 'bearer';
  const oauth = props.authKind === 'oauth';
  const registered = props.oauthRegistration === 'registered';
  const needsSetup = registered && !needsAccountChoice && options.configured === false;
  const meta = integrationMeta(props.providerId);
  const setup = bearer || props.endpointConfig ? meta.setup : undefined;

  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const result = await requestConnection({ ...selectRequestAccount(props, selectedAccountId || undefined), ...endpointSelection, token }, {
        post: (...[path, body]) => path === '/integrations/connect' ? trpcClient.integrations.connectPost.mutate({ body }) : trpcClient.integrations.connectDirectPost.mutate({ body }), openAuthorization: openIntegrationAuthorization,
      });
      setToken('');
      setMessage(result);
    } catch (error) { setMessage(apiErrorText(error)); }
    finally {
      if (props.endpointConfig || registered) router.refresh();
      setBusy(false);
    }
  }

  return <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-5 p-8">
    <h1 className="text-2xl font-semibold">Connect {props.displayName || 'an account'}</h1>
    <p>{needsSetup
      ? `Set up an OAuth app for ${props.displayName} in Settings, then return here to sign in.`
      : oauth
      ? 'A tool needs your permission to connect or update access. Review the permissions on the provider’s sign-in page.'
      : bearer
        ? 'Add or replace your connection token to restore access. Your token is stored encrypted and never shown to agents.'
        : 'Connect this service to make its tools available. No account or token is required.'}</p>
    {oauth && props.scopes.length > 0 && <details><summary>Requested access</summary><ul className="mt-2 break-all text-sm">{props.scopes.map(scope => <li key={scope}>{scope}</li>)}</ul></details>}
    {(props.accounts?.length ?? 0) > 1 && <div className="space-y-2">
      <label htmlFor="requested-account" className="text-sm font-medium">Account</label>
      <select id="requested-account" className="w-full rounded-md border bg-background p-2 text-sm" disabled={busy} value={selectedAccountId} onChange={event => { setSelectedAccountId(event.target.value); setToken(''); setEndpointSelection({}); setMessage(''); }}>
        <option value="">Choose an account</option>
        {props.accounts?.map(account => <option key={account.connectionId} value={account.connectionId}>{account.label}</option>)}
      </select>
    </div>}
    {needsSetup ? <Link href="/?settings=plugins" className="text-sm font-medium underline">Set up in Settings</Link> : <form onSubmit={(event) => void connect(event)} className="space-y-4">
      {options.endpointConfig && !needsAccountChoice && <HostedEndpointFields setup={options.endpointConfig} value={endpointSelection} onChange={setEndpointSelection} disabled={busy} />}
      {setup && <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">{setup.map(step => <li key={step}>{step}</li>)}</ol>}
      {oauth && props.endpointConfig && meta.docsUrl && <a href={meta.docsUrl} target="_blank" rel="noopener noreferrer" className="block text-sm underline">Setup guide</a>}
      {bearer && <>
        {props.helpUrl && <a href={props.helpUrl} target="_blank" rel="noopener noreferrer" className="block text-sm underline">Get your {props.displayName} token</a>}
        <div className="space-y-2">
          <label htmlFor="connection-token" className="text-sm font-medium">{props.credentialLabel ?? 'Connection token'}</label>
          <Input id="connection-token" type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} disabled={busy} required />
        </div>
      </>}
      <Button type="submit" disabled={busy || needsAccountChoice || !props.providerId || (bearer && !token.trim()) || !integrationEndpointReady(options.endpointConfig, endpointSelection)}>
        {busy ? oauth ? 'Preparing sign-in…' : 'Connecting…' : oauth ? 'Continue to sign-in' : `Connect ${props.displayName}`}
      </Button>
    </form>}
    {message && <p role="status">{message}</p>}
    {registered && !needsSetup && <Link href="/?settings=plugins" className="text-sm underline">Manage OAuth apps in Settings</Link>}
    <Link href="/?settings=plugins" className="text-sm underline">Back to connections</Link>
  </main>;
}
