'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppWindow, ArrowLeft, FileBox, Loader2, MessageCircle, PanelRightOpen, RotateCcw, Server, Settings2 } from 'lucide-react';
import { trpc, trpcClient } from '@/lib/trpc/client';
import type { RouterOutputs } from '@/lib/trpc/router';
import { Button } from '@/components/ui/button';
import { IntegrationLogo } from '@/components/integrations/integration-logo';
import { integrationMeta, starterPrompt } from '@/components/integrations/integration-meta';
import { useDashboard } from '@/contexts/dashboard-context';
import { mainChatKey } from '@/hooks/use-main-chat';
import { offerSourceToChat } from '@/lib/client/source-handoff';
import { ageLabel } from '@/lib/harness/rate-limit-display';
import { cn } from '@/lib/utils';
import { connectedAppsQuery } from './catalog';
import { ConnectedView } from './view';
import { EntrypointIcon } from './entrypoint-icon';
import { Tip } from '@/components/ui/tip';

type App = RouterOutputs['connectedApps']['catalog'][number];
type Entrypoint = App['entrypoints'][number];
type Navigate = (route: string, options?: { replace?: boolean }) => void;

/**
 * A connected service's page in Apps (docs/connected-mcp-apps.md). Chat is where
 * a service is used: Try in chat opens the conversation with the service
 * mentioned and a starter prompt written, and the agent picks the tools and
 * their inputs. The page has no tool forms.
 *
 * A standalone screen (a global entrypoint) opens full screen here: Open app,
 * or a click on its row in the rail's Apps flyout or ⌘K (`open`), calls that
 * tool with `{}` as OpenAI's MCP extensions spec has it. Once it opens, the URL
 * names the screen (`screen`), so a refresh reopens it rather than running the
 * entrypoint again. Opening it while it is open returns to it, and Reload
 * starts it over. `path` is OpenAI's deep link, the app-relative URL the
 * screen shows: it reaches a new screen at initialization and an open one as
 * `host-context-changed`. `result` reopens one of the recent interactive results.
 */
export function ConnectedAppPage({serverId, navigate, resultId, screenId, launch, deepLink}: {serverId: string; navigate: Navigate; resultId?: string; screenId?: string; launch?: string; deepLink?: string}) {
  const catalog = useQuery(connectedAppsQuery(0));
  const app = catalog.data?.find(item => item.id === serverId);
  const [open, setOpen] = useState<string | null>(resultId ?? null);
  const queryClient = useQueryClient();
  const page = `~connected/${serverId}`;
  const onScreen = useCallback((captureId: string, link?: string | null) => {
    navigate(`${page}?screen=${encodeURIComponent(captureId)}${link ? `&path=${encodeURIComponent(link)}` : ''}`, {replace: true});
    void queryClient.invalidateQueries({queryKey: trpc.connectedApps.catalog.queryKey()});
  }, [navigate, page, queryClient]);
  const screen = useScreenLaunch(app, onScreen);
  // A click on the flyout row, ⌘K or a deep link is the person asking to open it, once per request.
  const handled = useRef<string | null>(null);
  useEffect(() => { if (!launch) handled.current = null; }, [launch]);
  useEffect(() => {
    const request = launch ? `${launch}\n${deepLink ?? ''}` : null;
    if (!request || handled.current === request || !app) return;
    handled.current = request;
    const entry = app.entrypoints.find(item => item.name === launch) ?? app.entrypoints[0];
    if (entry && app.available) void screen.open(entry, {deepLink});
    else screen.fail(app.available ? `${app.toolkitName} has no screen to open on its own. Try it in chat instead.` : 'Reconnect or turn on this account to open it.');
  }, [launch, deepLink, app, screen]);

  if (!app) return <div className="space-y-3 p-6 text-sm"><Button variant="ghost" onClick={() => navigate('')}><ArrowLeft size={14}/>Apps</Button><p>{catalog.error?.message ?? (catalog.isPending ? 'Loading app…' : 'This connection does not currently offer an interface.')}</p></div>;
  const accounts = catalog.data?.filter(candidate => app.providerId ? candidate.providerId === app.providerId : candidate.id === app.id) ?? [];
  const recent = [...app.recent].sort((a, b) => b.created - a.created);
  // A result opened just now may not be in the cached list yet, and an expired one says so when it opens.
  const opened = open ? recent.find(item => item.id === open) ?? {id: open, chatId: undefined, title: app.toolkitName, launched: false} : null;
  const description = app.providerId ? integrationMeta(app.providerId).description : '';
  const fullScreen = !!screenId || screen.state.kind !== 'idle';
  const leaveScreen = () => { screen.reset(); navigate(page); };
  // The open screen's entrypoint, so Reload can start it over. A screen opened a moment ago may not be in the cached list yet.
  const screenTool = screenId ? app.recent.find(item => item.id === screenId)?.tool : undefined;
  const screenEntry = screenId ? app.entrypoints.find(entry => entry.name === screenTool) ?? (app.entrypoints.length === 1 ? app.entrypoints[0] : undefined) : undefined;

  const header = <header className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-2.5">
    {fullScreen
      ? <Button variant="ghost" size="sm" onClick={leaveScreen}><ArrowLeft size={14}/>{app.toolkitName}</Button>
      : <Button variant="ghost" size="sm" onClick={() => navigate('')}><ArrowLeft size={14}/>Apps</Button>}
    <div className="flex-1"/>
    {fullScreen && screenEntry && screen.state.kind === 'idle' && <Tip label={`Start ${screenEntry.title} over`}>
      <Button size="sm" variant="ghost" aria-label={`Reload ${screenEntry.title}`} onClick={() => void screen.open(screenEntry, {fresh: true})}><RotateCcw size={14}/>Reload</Button>
    </Tip>}
    {accounts.length > 1 && <select aria-label="Connected account" value={app.id} onChange={event => navigate(`~connected/${event.target.value}`)} className="max-w-48 rounded-md border bg-background p-1.5 text-xs">{accounts.map(account => <option key={account.id} value={account.id}>{account.account}</option>)}</select>}
    <Button size="sm" variant="ghost" onClick={() => navigate(app.providerId ? `?provider=${encodeURIComponent(app.providerId)}` : `?mcp=${encodeURIComponent(app.id)}`)}><Settings2 size={14}/>Connection</Button>
  </header>;

  if (fullScreen) return <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
    {header}
    <div className="flex min-h-0 flex-1 flex-col">
      {screen.state.kind === 'idle' && screenId
        ? <ConnectedView key={screenId} captureId={screenId} expanded appName={app.toolkitName} deepLink={deepLink}/>
        : <ScreenStatus app={app} screen={screen} onBack={leaveScreen}/>}
    </div>
  </div>;

  return <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
    {header}
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-8 sm:px-8"><div className="mx-auto max-w-3xl space-y-8">
      <section className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <ServiceLogo app={app}/>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h1 className="text-lg font-semibold leading-tight">{app.toolkitName}</h1>
            {/* A custom server's account is the server itself, so say what it is rather than repeat its slug. */}
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{app.providerId ? app.account : 'MCP server you added'}</p>
          </div>
          {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
          {!app.available && <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">Reconnect or turn on this account to use it.</p>}
          <div className="flex flex-wrap items-center gap-2">
            <TryInChat app={app}/>
            {app.entrypoints.map(entry => <Button key={entry.name} size="sm" variant="outline" disabled={!app.available} onClick={() => void screen.open(entry)}>
              <EntrypointIcon icons={entry.icons} size={14}/>{app.entrypoints.length > 1 ? `Open ${entry.title}` : 'Open app'}
            </Button>)}
          </div>
          <AppPlaces app={app}/>
          <p className="max-w-prose text-xs text-muted-foreground">
            {app.standalone
              ? `Open ${app.toolkitName} on its own, or ask in chat. Mention it with @ and your agent uses this account.`
              : `${app.toolkitName} works in chat. Mention it with @ and your agent uses this account. Interactive results show in the conversation.`}
          </p>
        </div>
      </section>
      {opened && <section aria-label="Open result">
        <ConnectedView key={opened.id} captureId={opened.id} chatId={opened.chatId} onClose={() => setOpen(null)}/>
      </section>}
      <section aria-labelledby="recent-results" className="space-y-2">
        <h2 id="recent-results" className="text-sm font-medium">Recent results</h2>
        {recent.length === 0
          ? <p className="text-xs text-muted-foreground">{app.views.length
            ? `When your agent uses ${app.views.map(view => view.title).join(', ')}, the interactive result shows in chat and here for 30 minutes.`
            : `Screens you open show here for 30 minutes.`}</p>
          : <ul className="divide-y divide-border rounded-lg border border-border">{recent.map(item => <li key={item.id}>
            {/* A screen reopens full screen. A chat's result opens here on the page. */}
            <button type="button" aria-pressed={item.id === open} onClick={() => item.launched ? navigate(`${page}?screen=${encodeURIComponent(item.id)}`) : setOpen(item.id === open ? null : item.id)}
              className={cn('flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/40', item.id === open && 'bg-muted/40')}>
              <AppWindow size={14} className="shrink-0 text-muted-foreground"/>
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{item.chatId ? 'From a chat · ' : ''}{ageLabel(new Date(item.created).toISOString())}</span>
            </button>
          </li>)}</ul>}
      </section>
    </div></div>
  </div>;
}

/**
 * Where else the app opens: tabs it offers beside a chat (OpenAI's thread
 * entrypoint), from the app button by the composer, and the file types it
 * opens (its file entrypoint), from Open with on a file.
 */
function AppPlaces({app}: {app: App}) {
  if (!app.threads.length && !app.files.length) return null;
  return <ul className="space-y-1.5 text-xs text-muted-foreground">
    {app.threads.map(thread => <li key={thread.name} className="flex items-center gap-2">
      <PanelRightOpen size={13} className="shrink-0"/><span><span className="text-foreground">{thread.title}</span> opens beside any chat from the app button by the message box.</span>
    </li>)}
    {app.files.map(file => <li key={file.name} className="flex items-center gap-2">
      <FileBox size={13} className="shrink-0"/><span><span className="text-foreground">{file.title}</span> opens {file.extensions.join(', ')} files from Open with on the file.</span>
    </li>)}
  </ul>;
}

function ServiceLogo({app}: {app: App}) {
  if (app.providerId) return <IntegrationLogo providerId={app.providerId} name={app.toolkitName} size={56} className="rounded-2xl"/>;
  return <span aria-hidden className="inline-flex size-14 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><Server size={24}/></span>;
}

/**
 * Opens the person's main chat with the service mentioned and a starter
 * prompt written after it, ready to send, as ChatGPT's Try does. Nothing is
 * sent and no access changes.
 */
function TryInChat({app}: {app: App}) {
  const dashboard = useDashboard();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const prompt = starterPrompt(app.providerId, app.toolkitName);
  const start = async () => {
    setBusy(true); setFailure(null);
    try {
      if (!app.sourceRef) throw new Error('Reconnect this account to use it in chat.');
      const main = await queryClient.fetchQuery({queryKey: mainChatKey(null), queryFn: () => trpcClient.orchestratorChat.list.query({}), staleTime: 0});
      offerSourceToChat(main.session.id, app.sourceRef, {prompt});
      dashboard.goHome(); dashboard.showPanelTab('chat'); dashboard.setMobileTab('chat');
      if (dashboard.isFocusMode) dashboard.exitFocusMode();
    } catch (error) { setFailure(error instanceof Error ? error.message : 'The chat could not open'); }
    finally { setBusy(false); }
  };
  return <>
    <Button size="sm" disabled={busy || !app.available || !app.sourceRef} onClick={() => void start()}>
      {busy ? <Loader2 size={14} className="animate-spin"/> : <MessageCircle size={14}/>}Try in chat
    </Button>
    <span className="text-xs text-muted-foreground">“{prompt}”</span>
    {failure && <p role="alert" className="w-full text-xs text-destructive">{failure}</p>}
  </>;
}

type ScreenState =
  | {kind: 'idle'}
  | {kind: 'opening'; entry: Entrypoint}
  | {kind: 'approval'; entry: Entrypoint; viewId: string; invocationId: string; ids: string[]; preview?: unknown; deepLink?: string}
  | {kind: 'error'; entry?: Entrypoint; message: string};
type ScreenLaunch = ReturnType<typeof useScreenLaunch>;

/**
 * Opening a standalone screen: its global entrypoint runs with `{}` through the
 * ordinary approval gate. Leaving cancels an unanswered launch. A failure shows
 * as it is, and trying again is a new request rather than a replay.
 */
function useScreenLaunch(app: App | undefined, onScreen: (captureId: string, deepLink?: string | null) => void) {
  const [state, setState] = useState<ScreenState>({kind: 'idle'});
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const active = useRef<{viewId: string; invocationId: string} | null>(null);
  const serverId = app?.id;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (active.current) void trpcClient.connectedApps.cancel.mutate(active.current).catch(() => {});
    };
  }, []);
  const launch = useCallback(async (entry: Entrypoint, request: {viewId: string; invocationId: string}, link?: string) => {
    active.current = request;
    const result = await trpcClient.connectedApps.launch.mutate({viewId: request.viewId});
    if (!alive.current) return;
    if (result.kind === 'approval') { setState({kind: 'approval', entry, viewId: result.viewId, invocationId: request.invocationId, ids: result.ids, preview: result.preview, deepLink: link}); return; }
    active.current = null;
    setState({kind: 'idle'});
    onScreen(result.captureId, link);
  }, [onScreen]);
  const open = useCallback(async (entry: Entrypoint, options: {deepLink?: string; fresh?: boolean} = {}) => {
    if (!serverId) return;
    setBusy(true);
    try {
      const prepared = await trpcClient.connectedApps.prepare.mutate({serverId, name: entry.name, ...(options.deepLink ? {deepLink: options.deepLink} : {}), ...(options.fresh ? {fresh: true} : {})});
      // The screen is already open: return to it, with the deep link if any, rather than calling the entrypoint again.
      if (prepared.kind === 'open') { if (alive.current) { setState({kind: 'idle'}); onScreen(prepared.captureId, prepared.deepLink); } return; }
      setState({kind: 'opening', entry});
      const request = {viewId: prepared.viewId, invocationId: prepared.invocationId};
      if (!alive.current) { await trpcClient.connectedApps.cancel.mutate(request); return; }
      await launch(entry, request, options.deepLink);
    } catch (e) { if (alive.current) { active.current = null; setState({kind: 'error', entry, message: e instanceof Error ? e.message : 'The app could not open'}); } }
    finally { if (alive.current) setBusy(false); }
  }, [serverId, launch, onScreen]);
  const decide = useCallback(async (approve: boolean) => {
    if (state.kind !== 'approval' || busy) return;
    setBusy(true);
    try {
      await trpcClient.connectedApps.approval.mutate({viewId: state.viewId, ids: state.ids, approve});
      if (!approve) {
        await trpcClient.connectedApps.cancel.mutate({viewId: state.viewId, invocationId: state.invocationId});
        if (!alive.current) return;
        active.current = null; setState({kind: 'idle'}); return;
      }
      if (!alive.current) return;
      setState({kind: 'opening', entry: state.entry});
      await launch(state.entry, {viewId: state.viewId, invocationId: state.invocationId}, state.deepLink);
    } catch (e) { if (alive.current) setState({kind: 'error', entry: state.entry, message: e instanceof Error ? e.message : 'The decision could not be saved'}); }
    finally { if (alive.current) setBusy(false); }
  }, [state, busy, launch]);
  const reset = useCallback(() => {
    if (active.current) void trpcClient.connectedApps.cancel.mutate(active.current).catch(() => {});
    active.current = null; setState({kind: 'idle'});
  }, []);
  const fail = useCallback((message: string) => setState({kind: 'error', message}), []);
  return {state, busy, open, decide, reset, fail};
}

/** What fills the screen while it opens: progress, the approval it needs, or why it could not open. */
function ScreenStatus({app, screen, onBack}: {app: App; screen: ScreenLaunch; onBack: () => void}) {
  const {state, busy} = screen;
  return <div className="flex flex-1 items-center justify-center p-8">
    <div className="w-full max-w-md space-y-4 text-center text-sm">
      {state.kind === 'opening' && <p role="status" className="flex items-center justify-center gap-2 text-muted-foreground"><Loader2 size={14} className="animate-spin"/>Opening {app.toolkitName}…</p>}
      {state.kind === 'approval' && <div role="group" aria-label={`Allow ${app.toolkitName} to open`} className="space-y-3 rounded-xl bg-amber-500/10 p-4 text-left">
        <p>Allow {app.toolkitName} to open {state.entry.title}?</p>
        {state.preview != null && <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(state.preview, null, 2)}</pre>}
        <div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => void screen.decide(true)}>Allow once</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void screen.decide(false)}>Decline</Button></div>
      </div>}
      {state.kind === 'error' && <div role="alert" className="space-y-3">
        <p className="font-medium">{app.toolkitName} could not open</p>
        <p className="whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{state.message}</p>
        <div className="flex justify-center gap-2">
          {state.entry && <Button size="sm" variant="outline" disabled={busy} onClick={() => void screen.open(state.entry!)}>Try again</Button>}
          <Button size="sm" variant="ghost" onClick={onBack}>Back to {app.toolkitName}</Button>
        </div>
      </div>}
    </div>
  </div>;
}
