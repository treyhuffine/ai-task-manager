'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiErrorText } from '@/lib/api/client';
import { INTEGRATION_LABELS } from '@/constants/integrations';

function SetupStep({ number, label, children }: { number: number; label: string; children: ReactNode }) {
  return <li className="space-y-3 border-t pt-5 first:border-0 first:pt-0">
    <h4 className="font-medium">{number}. {label}</h4>
    {children}
  </li>;
}

function SlackTokenField({ kind, id, label, value, onChange }: {
  kind: 'bot' | 'app'; id: string; label: string; value: string; onChange: (value: string) => void;
}) {
  return <div className="space-y-2">
    <div id={`${id}-help`} className="space-y-2 text-sm text-muted-foreground">
      {kind === 'bot' ? <>
        <p>In your Slack app settings, open <strong>OAuth &amp; Permissions</strong>. If the app is not installed yet, click <strong>Install to Workspace</strong> and approve the installation.</p>
        <p>Copy the <strong>Bot User OAuth Token</strong> beginning with <code>xoxb-</code>, then paste it below. Already installed? Use the token on that same page.</p>
      </> : <>
        <p>Open <strong>Basic Information → App-Level Tokens → Generate Token and Scopes</strong>.</p>
        <p>Name the token, for example <strong>Ri Socket Mode</strong>. Add the <code>connections:write</code> scope, click <strong>Generate</strong>, and copy the token beginning with <code>xapp-</code>.</p>
        <p>In <strong>Socket Mode</strong>, confirm <strong>Enable Socket Mode</strong> is on. The manifest enables it for you.</p>
      </>}
    </div>
    <Label htmlFor={id}>{label}</Label>
    <Input id={id} type="password" autoComplete="off" value={value} onChange={event => onChange(event.target.value)}
      placeholder={kind === 'bot' ? 'xoxb-…' : 'xapp-…'} aria-describedby={`${id}-help`} required />
  </div>;
}

export function ConversationsSection() {
  const [provider, setProvider] = useState<'slack' | 'buzz'>('slack');
  const [name, setName] = useState('Ri Personal');
  const [workspaceId, setWorkspaceId] = useState('');
  const [channels, setChannels] = useState('');
  const [botToken, setBotToken] = useState('');
  const [appToken, setAppToken] = useState('');
  const [relay, setRelay] = useState('ws://localhost:3000');
  const [notice, setNotice] = useState('');
  const [copiedManifestName, setCopiedManifestName] = useState<string | null>(null);
  const [link, setLink] = useState<{ id: string; command: string; buzz: boolean; expiresAt: number } | null>(null);
  const [copiedLinkCommand, setCopiedLinkCommand] = useState<string | null>(null);
  const [buzzSetup, setBuzzSetup] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [newBotToken, setNewBotToken] = useState('');
  const [newAppToken, setNewAppToken] = useState('');
  const [newConnectionId, setNewConnectionId] = useState<string | null>(null);
  const savedConnectionRef = useRef<HTMLElement | null>(null);
  const query = useQuery({ ...trpc.conversationIntegrations.list.queryOptions(),
    refetchInterval: query => link && Date.now() < link.expiresAt && !query.state.data?.connections.find(connection => connection.id === link.id)?.identities.some(identity => identity.mine) ? 2000 : false,
  });
  const reconnect = useMutation({ mutationFn: (id: string) => trpcClient.conversationIntegrations.reconnectSlack.mutate({ id, botToken: newBotToken, appToken: newAppToken }), meta: { carriesInput: true },
    onSuccess: () => { setEditing(null); setNewBotToken(''); setNewAppToken(''); void query.refetch(); }, onError: error => setNotice(apiErrorText(error)) });
  const mutate = useMutation({ mutationFn: async (operation: () => Promise<unknown>) => operation(), onSuccess: () => { void query.refetch(); }, onError: error => setNotice(apiErrorText(error)) });
  const create = useMutation({ mutationFn: () => trpcClient.conversationIntegrations.create.mutate({ provider, name, workspaceId: workspaceId || null,
    channels: channels.split(/[\s,]+/).filter(Boolean), ...(provider === 'slack' ? { botToken, appToken } : { relay }) }), meta: { carriesInput: true },
    onSuccess: result => {
      setBotToken(''); setAppToken(''); setNotice(''); setNewConnectionId(result.connection.id);
      if (result.bridgeToken) {
        const url = result.bridgeUrl;
        setBuzzSetup(`RI_CONVERSATION_URL=${url}\nRI_CONVERSATION_TOKEN=${result.bridgeToken}\nBUZZ_ACP_AGENT_COMMAND=ri\nBUZZ_ACP_AGENT_ARGS=acp\nBUZZ_ACP_RESPOND_TO=owner-only\nBUZZ_RELAY_URL=${relay}`);
      }
      void query.refetch();
    }, onError: error => setNotice(apiErrorText(error)) });
  // Render the confirmed save immediately, even while the list is refreshing.
  const newConnection = query.data?.connections.find(connection => connection.id === newConnectionId)
    ?? (create.data?.connection.id === newConnectionId ? { ...create.data.connection, identities: [] } : undefined);
  const connections = [...(query.data?.connections.filter(connection => connection.id !== newConnectionId) ?? []), ...(newConnection ? [newConnection] : [])];
  const savedConnectionId = newConnection?.id;
  useEffect(() => {
    if (!newConnectionId || savedConnectionId !== newConnectionId) return;
    savedConnectionRef.current?.focus({ preventScroll: true });
    savedConnectionRef.current?.scrollIntoView({ block: 'start' });
  }, [newConnectionId, savedConnectionId]);
  const disabled = create.isPending || mutate.isPending || reconnect.isPending;
  const destinationFields = <>
    <div className="space-y-2"><Label htmlFor="conversation-name">Name</Label><Input id="conversation-name" value={name} onChange={event => setName(event.target.value)} required maxLength={provider === 'slack' ? 35 : 60} /><p className="text-xs text-muted-foreground">Use a name such as Ri Personal or Ri Team. Distinct Slack mentions require distinct Slack apps.</p></div>
    <div className="space-y-2"><Label htmlFor="conversation-target">Ri destination</Label><select id="conversation-target" className="w-full rounded-md border bg-background p-2" value={workspaceId} onChange={event => setWorkspaceId(event.target.value)} required={query.data?.team}>
      <option value="">{query.data?.team ? 'Select a team agent' : 'Personal orchestrator'}</option>{query.data?.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></div>
  </>;
  const channelField = <div className="space-y-2">
    <Label htmlFor="conversation-channels">Connected channel IDs</Label>
    <Input id="conversation-channels" value={channels} onChange={event => setChannels(event.target.value)} placeholder={provider === 'slack' ? 'C0123456789, C0987654321' : 'Buzz channel UUID'} required={query.data?.team || provider === 'buzz'} />
    <p className="text-xs text-muted-foreground">{query.data?.team ? 'Choose channels intended for the whole Ri team. Invite the Slack app to each channel.' : 'Separate IDs with commas. Leave empty for personal Slack DMs only.'}</p>
  </div>;
  return <div className="space-y-6">
    <div className="space-y-2 text-sm">
      <p>Talk to your Ri agent from Slack or Buzz. Each connection has its own name and a fixed Ri destination. Conversations are saved in Ri and replies return to their originating thread.</p>
      <p className="text-muted-foreground">{`Your existing Slack ${INTEGRATION_LABELS.singular} provides search, reading and sending tools for the account you authorize. Add an agent connection here to receive mentions and DMs.`}</p>
      {!query.data?.team && <a className="inline-block underline" href="/connect?provider=slack">Connect Slack account tools</a>}
      {query.data?.team && <p>Connected channel conversations are visible to this Ri team. Private DMs are not accepted. Each Slack participant must link their own Ri sign-in.</p>}
    </div>
    {query.isPending && <p role="status">Loading connections…</p>}
    {query.error && <p role="alert">{apiErrorText(query.error)} <Button variant="outline" onClick={() => void query.refetch()}>Retry</Button></p>}
    {connections.map(connection => <section key={connection.id} id={`conversation-${connection.id}`} ref={connection.id === newConnectionId ? savedConnectionRef : undefined} tabIndex={-1} className="scroll-mt-4 space-y-3 rounded-lg border p-4 focus:outline-none focus:ring-2 focus:ring-ring" aria-label={connection.name}>
      {connection.id === newConnectionId && <div role="status" className="space-y-1 rounded-md bg-muted p-3">
        <p className="font-medium">{connection.provider === 'slack' ? 'Slack app saved' : 'Buzz connection saved'}</p>
        <p className="text-sm">{connection.name} will talk to {query.data?.agents.find(agent => agent.id === connection.workspaceId)?.name ?? 'your personal orchestrator'} in Ri.</p>
        <p className="text-sm">{connection.provider === 'slack' ? connection.identities.some(identity => identity.mine) ? 'Your Slack identity is linked. Follow the conversation test below.' : 'Your tokens are saved. Next, link your Slack identity below, then send a test message.' : 'Next, save the bridge credentials below and use them to start buzz-acp.'}</p>
      </div>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="font-medium">{connection.name}</h3><p className="text-xs text-muted-foreground">{connection.provider === 'slack' ? 'Slack' : 'Buzz'} · {connection.enabled ? 'Enabled' : 'Paused'} · {query.data?.agents.find(agent => agent.id === connection.workspaceId)?.name ?? 'Personal orchestrator'}</p></div>
        {query.data?.canManage && <div className="flex gap-2"><Button variant="outline" size="sm" disabled={disabled} onClick={() => mutate.mutate(() => trpcClient.conversationIntegrations.setEnabled.mutate({ id: connection.id, enabled: !connection.enabled }))}>{connection.enabled ? 'Pause' : 'Enable'}</Button>
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => mutate.mutate(async () => { await trpcClient.conversationIntegrations.remove.mutate({ id: connection.id }); if (connection.id === newConnectionId) { setNewConnectionId(null); setBuzzSetup(null); } })}>Disconnect</Button></div>}
      </div>
      {connection.error && <p role="alert" className="text-sm text-destructive">{connection.error}</p>}
      {query.data?.canManage && connection.provider === 'slack' && <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => setEditing(editing === connection.id ? null : connection.id)}>Update Slack tokens</Button>
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => mutate.mutate(() => trpcClient.conversationIntegrations.retryDelivery.mutate({ id: connection.id }))}>Retry delivery</Button>
      </div>}
      {editing === connection.id && <form aria-label={`${connection.name} Slack tokens`} className="space-y-2 rounded border p-3" onSubmit={event => { event.preventDefault(); reconnect.mutate(connection.id); }}>
        <a className="inline-block text-sm underline" href="https://api.slack.com/apps" target="_blank" rel="noreferrer">Open Slack app settings</a>
        <SlackTokenField kind="app" id={`app-${connection.id}`} label="New app-level token" value={newAppToken} onChange={setNewAppToken} />
        <SlackTokenField kind="bot" id={`bot-${connection.id}`} label="New bot token" value={newBotToken} onChange={setNewBotToken} />
        <p className="text-xs text-muted-foreground">Use tokens for this same app and workspace. Saved chats and pending replies are kept.</p><Button disabled={disabled}>Reconnect</Button>
      </form>}
      <p className="break-words text-xs text-muted-foreground">{connection.channels.length ? `Channels: ${connection.channels.join(', ')}` : 'Personal DMs only'}</p>
      {connection.provider === 'slack' && <div className="space-y-3 border-t pt-3 text-sm">
        <h4 className="font-medium">6. Link your Slack identity</h4>
        {connection.identities.some(identity => identity.mine) ? <p role="status" className="font-medium">Slack identity linked. You can send a test message now.</p> : <p>Connect your Slack user to your current Ri sign-in. Each person completes this step for themselves.</p>}
        {!query.data?.team && <details className="space-y-2 text-muted-foreground">
          <summary className="cursor-pointer">Can’t send a DM to this app?</summary>
          <p>If Slack says “Sending messages to this app has been turned off,” open <strong>App Manifest</strong> in your Slack app settings. Under <code>features.app_home</code>, set <code>messages_tab_enabled</code> to <code>true</code> and <code>messages_tab_read_only_enabled</code> to <code>false</code>.</p>
          <p>Save any changes, reload Slack, then try sending your link command again. Ri’s current manifest enables this setting, but your installed app may have different settings.</p>
          <a className="inline-block underline" href="https://api.slack.com/apps" target="_blank" rel="noreferrer">Open Slack app settings</a>
        </details>}
      </div>}
      {(connection.provider === 'buzz' || !connection.identities.some(identity => identity.mine)) && <Button variant="outline" size="sm" disabled={disabled || !connection.enabled} onClick={() => mutate.mutate(async () => { const result = await trpcClient.conversationIntegrations.link.mutate({ id: connection.id }); setLink({ id: connection.id, command: result.bridgeCommand ?? result.command, buzz: connection.provider === 'buzz', expiresAt: Date.now() + result.expiresInMinutes * 60_000 }); })}>{connection.provider === 'buzz' ? 'Authorize my Buzz bridge' : link?.id === connection.id ? 'Generate new link code' : 'Link my Slack identity'}</Button>}
      {link?.id === connection.id && (link.buzz || !connection.identities.some(identity => identity.mine)) && <div className="space-y-3 text-sm">
        {link.buzz ? <p>Run this on the bridge computer with RI_CONVERSATION_TOKEN loaded. It binds that bridge to your current Ri sign-in. Its Buzz identity must use you as its registered owner and the owner-only gate.</p> : <>
          <p><strong>In Slack:</strong> {query.data?.team || connection.channels.length ? <>Open one of the connected channels above. Type <strong>@</strong> and select this Slack app, then paste the command below after the mention. Send it as one message.</> : <>Open a DM with this Slack app and send the command below.</>}</p>
          {!query.data?.team && connection.channels.length > 0 && <p>You can also send the command in a DM with this Slack app.</p>}
        </>}
        <code className="block break-all rounded bg-muted p-2">{link.command}</code>
        <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(link.command).then(() => setCopiedLinkCommand(link.command)).catch(error => setNotice(apiErrorText(error)))}>{copiedLinkCommand === link.command ? 'Link command copied' : 'Copy link command'}</Button>
        <p className="text-muted-foreground">The code expires in 10 minutes. Generate a new link code if it expires.</p>
        {!link.buzz && <>
          <p>Slack should reply: “Your identity is linked. Send your message again to begin.” Ri checks for that link automatically until the code expires.</p>
          <p role="status">Waiting for your Slack message…</p>
          <Button variant="outline" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? 'Checking…' : 'Check link'}</Button>
        </>}
      </div>}
      {connection.identities.map(identity => <p key={identity.id} className="flex items-center gap-2 text-xs">{identity.externalUserId}{identity.mine ? ' (you)' : ''}{identity.mine && <button type="button" className="underline" disabled={disabled} onClick={() => mutate.mutate(() => trpcClient.conversationIntegrations.unlink.mutate({ id: identity.id }))}>Unlink</button>}</p>)}
      {connection.provider === 'slack' && connection.identities.some(identity => identity.mine) && <div className="space-y-2 border-t pt-3 text-sm">
        <h4 className="font-medium">7. Test a two-way conversation</h4>
        <ol className="list-decimal space-y-2 pl-5">
          <li>Send a new message to this Slack app: <strong>Hello. Can you hear me?</strong> {query.data?.team || connection.channels.length ? 'In a connected channel, include the app’s @mention.' : 'Use the same DM.'}</li>
          <li>Wait for Ri’s reply in Slack. Linking alone does not start a conversation.</li>
          <li>Reply in that same thread: <strong>What did I just ask?</strong> Ri should answer with the conversation’s context.</li>
        </ol>
        <p className="text-muted-foreground">A reply confirms the conversation works in both directions. The same chat appears in Ri, where you can continue it too.</p>
      </div>}
    </section>)}
    {query.data?.canManage && newConnectionId && <Button variant="outline" onClick={() => setNewConnectionId(null)}>Add another connection</Button>}
    {query.data?.canManage && !newConnectionId && <form aria-label="Add a conversation connection" className="space-y-4 rounded-lg border p-4" onSubmit={event => { event.preventDefault(); setNotice(''); create.mutate(); }}>
      <h3 className="font-medium">Add a conversation connection</h3>
      <div className="space-y-2"><Label htmlFor="conversation-provider">Service</Label><select id="conversation-provider" className="w-full rounded-md border bg-background p-2" value={provider} onChange={event => setProvider(event.target.value as 'slack' | 'buzz')}><option value="slack">Slack</option><option value="buzz">Buzz by Block</option></select></div>
      {provider === 'slack' ? <ol className="space-y-5">
        <SetupStep number={1} label="Choose your Ri destination">{destinationFields}</SetupStep>
        <SetupStep number={2} label="Create or open your Slack app">
          <p className="text-sm text-muted-foreground">Already created the app from a manifest? Open its settings and continue with step 3.</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" disabled={disabled} onClick={() => mutate.mutate(async () => { const manifest = await trpcClient.conversationIntegrations.manifest.query({ name }); await navigator.clipboard.writeText(JSON.stringify(manifest, null, 2)); setCopiedManifestName(name); })}>{copiedManifestName === name ? 'Manifest copied' : 'Copy Slack app manifest'}</Button>
            <a className="text-sm underline" href="https://api.slack.com/apps" target="_blank" rel="noreferrer">Open Slack apps</a>
          </div>
          <p className="text-sm text-muted-foreground">To create an app, choose <strong>Create New App → From a manifest</strong> in Slack, select your Slack workspace, and paste the copied manifest. If you use Slack’s AI agent wizard instead, choose <strong>Starter agent</strong>.</p>
        </SetupStep>
        <SetupStep number={3} label="Get your app-level token">
          <SlackTokenField kind="app" id="conversation-app-token" label="App-level token" value={appToken} onChange={setAppToken} />
        </SetupStep>
        <SetupStep number={4} label="Get your bot token">
          <SlackTokenField kind="bot" id="conversation-bot-token" label="Bot token" value={botToken} onChange={setBotToken} />
        </SetupStep>
        <SetupStep number={5} label="Choose conversations and connect">
          <p className="text-sm text-muted-foreground">For channels, open each channel’s details in Slack, copy its <strong>Channel ID</strong>, and add this app to the channel.</p>
          {channelField}
          <Button type="submit" disabled={disabled}>{create.isPending ? 'Connecting…' : 'Connect'}</Button>
          <p className="text-xs text-muted-foreground">Next, link your Slack identity on the saved connection and try a message.</p>
        </SetupStep>
      </ol> : <>
        {destinationFields}
        {channelField}
        <div className="space-y-2"><Label htmlFor="conversation-relay">Buzz relay URL</Label><Input id="conversation-relay" value={relay} onChange={event => setRelay(event.target.value)} required /></div>
        <p className="text-sm">Ri uses Buzz’s ACP harness. Configure this named Buzz identity with the owner-only author gate. This bridge acts as your current Ri sign-in. Other people need their own authorized bridge.</p>
        <Button type="submit" disabled={disabled}>{create.isPending ? 'Connecting…' : 'Connect'}</Button>
      </>}
    </form>}
    {buzzSetup && <section className="space-y-2 rounded-lg border p-4"><h3 className="font-medium">Buzz bridge credentials</h3><p className="text-sm">Save these environment variables for buzz-acp. The connection token is shown once. Install the Ri CLI and Buzz CLI on that computer.</p><Textarea aria-label="Buzz bridge environment" value={buzzSetup} readOnly rows={7} /><Button variant="outline" onClick={() => void navigator.clipboard.writeText(buzzSetup)}>Copy environment</Button><Button variant="outline" onClick={() => setBuzzSetup(null)}>Hide credentials</Button></section>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </div>;
}
