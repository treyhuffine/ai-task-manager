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
  const query = useQuery(trpc.conversationIntegrations.list.queryOptions());
  const [provider, setProvider] = useState<'slack' | 'buzz'>('slack');
  const [name, setName] = useState('Ri Personal');
  const [workspaceId, setWorkspaceId] = useState('');
  const [channels, setChannels] = useState('');
  const [botToken, setBotToken] = useState('');
  const [appToken, setAppToken] = useState('');
  const [relay, setRelay] = useState('ws://localhost:3000');
  const [notice, setNotice] = useState('');
  const [copiedManifestName, setCopiedManifestName] = useState<string | null>(null);
  const [link, setLink] = useState<{ id: string; command: string; buzz: boolean } | null>(null);
  const [buzzSetup, setBuzzSetup] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [newBotToken, setNewBotToken] = useState('');
  const [newAppToken, setNewAppToken] = useState('');
  const newConnectionId = useRef<string | null>(null);
  useEffect(() => {
    const id = newConnectionId.current;
    if (!id || !query.data?.connections.some(connection => connection.id === id)) return;
    document.getElementById(`conversation-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    newConnectionId.current = null;
  }, [query.data]);
  const reconnect = useMutation({ mutationFn: (id: string) => trpcClient.conversationIntegrations.reconnectSlack.mutate({ id, botToken: newBotToken, appToken: newAppToken }), meta: { carriesInput: true },
    onSuccess: () => { setEditing(null); setNewBotToken(''); setNewAppToken(''); void query.refetch(); }, onError: error => setNotice(apiErrorText(error)) });
  const mutate = useMutation({ mutationFn: async (operation: () => Promise<unknown>) => operation(), onSuccess: () => { void query.refetch(); }, onError: error => setNotice(apiErrorText(error)) });
  const create = useMutation({ mutationFn: () => trpcClient.conversationIntegrations.create.mutate({ provider, name, workspaceId: workspaceId || null,
    channels: channels.split(/[\s,]+/).filter(Boolean), ...(provider === 'slack' ? { botToken, appToken } : { relay }) }), meta: { carriesInput: true },
    onSuccess: result => {
      setBotToken(''); setAppToken(''); setNotice(result.connection.provider === 'slack' ? 'Connection saved. Finish step 6 on your new connection.' : 'Connection saved.');
      if (result.connection.provider === 'slack') newConnectionId.current = result.connection.id;
      if (result.bridgeToken) {
        const url = result.bridgeUrl;
        setBuzzSetup(`RI_CONVERSATION_URL=${url}\nRI_CONVERSATION_TOKEN=${result.bridgeToken}\nBUZZ_ACP_AGENT_COMMAND=ri\nBUZZ_ACP_AGENT_ARGS=acp\nBUZZ_ACP_RESPOND_TO=owner-only\nBUZZ_RELAY_URL=${relay}`);
      }
      void query.refetch();
    }, onError: error => setNotice(apiErrorText(error)) });
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
    {query.data?.connections.map(connection => <section key={connection.id} id={`conversation-${connection.id}`} className="scroll-mt-4 space-y-3 rounded-lg border p-4" aria-label={connection.name}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="font-medium">{connection.name}</h3><p className="text-xs text-muted-foreground">{connection.provider === 'slack' ? 'Slack' : 'Buzz'} · {connection.enabled ? 'Enabled' : 'Paused'} · {query.data.agents.find(agent => agent.id === connection.workspaceId)?.name ?? 'Personal orchestrator'}</p></div>
        {query.data.canManage && <div className="flex gap-2"><Button variant="outline" size="sm" disabled={disabled} onClick={() => mutate.mutate(() => trpcClient.conversationIntegrations.setEnabled.mutate({ id: connection.id, enabled: !connection.enabled }))}>{connection.enabled ? 'Pause' : 'Enable'}</Button>
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => mutate.mutate(() => trpcClient.conversationIntegrations.remove.mutate({ id: connection.id }))}>Disconnect</Button></div>}
      </div>
      {connection.error && <p role="alert" className="text-sm text-destructive">{connection.error}</p>}
      {query.data.canManage && connection.provider === 'slack' && <div className="flex flex-wrap gap-2">
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
      {connection.provider === 'slack' && !connection.identities.some(identity => identity.mine) && <div className="space-y-2 border-t pt-3 text-sm">
        <h4 className="font-medium">6. Link yourself and try a message</h4>
        <p>Click <strong>Link my Slack identity</strong>, then send its command to this Slack app. Each person links their own Ri sign-in.</p>
      </div>}
      <Button variant="outline" size="sm" disabled={disabled || !connection.enabled} onClick={() => mutate.mutate(async () => { const result = await trpcClient.conversationIntegrations.link.mutate({ id: connection.id }); setLink({ id: connection.id, command: result.bridgeCommand ?? result.command, buzz: connection.provider === 'buzz' }); })}>{connection.provider === 'slack' ? 'Link my Slack identity' : 'Authorize my Buzz bridge'}</Button>
      {link?.id === connection.id && <div className="space-y-2 text-sm"><p>{link.buzz ? 'Run this on the bridge computer with RI_CONVERSATION_TOKEN loaded. It binds that bridge to your current Ri sign-in. Its Buzz identity must use you as its registered owner and the owner-only gate.' : 'Send this to the Slack app in a connected channel. For a personal connection you can use a DM.'} The code expires in 10 minutes.</p><code className="block break-all rounded bg-muted p-2">{link.command}</code><Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(link.command)}>Copy link command</Button></div>}
      {connection.identities.map(identity => <p key={identity.id} className="flex items-center gap-2 text-xs">{identity.externalUserId}{identity.mine ? ' (you)' : ''}{identity.mine && <button type="button" className="underline" disabled={disabled} onClick={() => mutate.mutate(() => trpcClient.conversationIntegrations.unlink.mutate({ id: identity.id }))}>Unlink</button>}</p>)}
      {connection.provider === 'slack' && <p className="text-sm text-muted-foreground">After linking, mention this app in a connected channel and say hello. For personal connections, you can also send a DM. Reply in the same thread to continue. Your conversation appears in Ri too.</p>}
    </section>)}
    {query.data?.canManage && <form aria-label="Add a conversation connection" className="space-y-4 rounded-lg border p-4" onSubmit={event => { event.preventDefault(); setNotice(''); create.mutate(); }}>
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
