'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppViewController } from '@ri/mcp-apps-host';
import { Loader2, PanelRightOpen, X } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { trpcClient } from '@/lib/trpc/client';
import type { RouterOutputs } from '@/lib/trpc/router';
import { registerConnectedContext, selectConnectedContext, setConnectedContextContent, type ContextBlock } from '@/lib/client/mcp-app-context';
import { requestAppChatMessage } from '@/lib/client/app-chat-intent';
import { AppMessageGate, appMessageParts, draftNotice, routeAppMessage, type GateRefusal } from '@/lib/client/app-message';
import { appMessageRouting } from '@/lib/client/app-message-routing';
import { uploadAttachment } from '@/lib/attachments/client';
import { useOptionalDashboard } from '@/contexts/dashboard-context';
import { useConnectedCompanion } from '@/lib/client/mcp-app-panel';
import { runConnectedInvocation } from '@/lib/client/mcp-app-invocation';
import { initialDisplayMode } from '@/lib/mcp-apps/metadata';
import { launchConnectedFile, showConnectedCapture } from '@/lib/client/mcp-app-file';
import { viewHref } from '@/lib/client/active-view';
import { attachmentUrl } from '@/lib/attachments/view';
import { ConnectedViewForms } from './form/view-forms';

type OpenView = RouterOutputs['connectedApps']['open'];
/** Results this browser already placed by their display mode, so scrolling back never moves one again. */
const placed = new Set<string>();
/** Only a result this recent opens itself beside the chat. */
const FRESH_RESULT_MS = 2 * 60_000;
type Pending = {ids: string[]; preview?: unknown; finish: (approve: boolean) => void};
/**
 * `onClose` puts a Close control in the result's own header row, for a page that shows the result beside
 * other content. `appName` is the name the surrounding page already shows: a full-screen view titled the
 * same skips its own title row rather than repeat it.
 */
export function ConnectedView({captureId, chatId, expanded = false, onClose, appName, deepLink}: {captureId: string; chatId?: string; expanded?: boolean; onClose?: () => void; appName?: string; deepLink?: string}) {
  const companion = useConnectedCompanion();
  const moved = !expanded && companion?.captureId === captureId;
  const [inlineMount, setInlineMount] = useState<HTMLDivElement | null>(null);
  const [container] = useState(() => {
    if (typeof document === 'undefined') return null;
    const element = document.createElement('div');
    element.className = 'flex h-full min-h-0 flex-col';
    return element;
  });
  const register = companion?.register;
  useEffect(() => { if (!expanded && register) return register(captureId); }, [captureId, expanded, register]);
  const destination = moved ? companion?.mount : inlineMount;
  useEffect(() => {
    if (!container || !destination) return;
    // moveBefore preserves a live iframe's document and JS state. Reparenting
    // with appendChild is the compatibility fallback on older browsers.
    if (container.isConnected && 'moveBefore' in destination) (destination as HTMLDivElement & {moveBefore(node: Node, before: Node | null): void}).moveBefore(container, null);
    else destination.appendChild(container);
  }, [container, destination]);
  useEffect(() => () => {container?.remove();}, [container]);
  const query = useQuery({queryKey: ['connected-app-view', captureId, chatId], queryFn: () => trpcClient.connectedApps.open.mutate({captureId, chatId}),
    retry: false, staleTime: Infinity});
  const access = useQuery({queryKey: ['connected-app-status', query.data?.id], queryFn: () => trpcClient.connectedApps.status.query({viewId: query.data!.id}), enabled: !!query.data, retry: false, refetchInterval: 15_000});
  const failure = query.error ?? access.error;
  const repeatsName = expanded && !!appName && query.data?.title?.toLocaleLowerCase() === appName.toLocaleLowerCase() && !onClose;
  // OpenAI's display modes: what the resource declares bounds where it may show.
  const modes = query.data?.resource?.displayModes;
  const canInline = !modes || modes.available.includes('inline');
  const canExpand = !modes || modes.available.includes('fullscreen');
  const openBeside = companion?.open;
  useEffect(() => {
    const data = query.data;
    if (!data?.resource || expanded || !openBeside || !chatId || data.kind !== 'result' || placed.has(captureId)) return;
    placed.add(captureId);
    // A model's result opens full screen (beside the chat) when its resource prefers it, or allows nothing else.
    const first = initialDisplayMode(data.resource.displayModes, data.resource.displayModes.declared);
    if ((first === 'fullscreen' || !canInline) && Date.now() - data.created < FRESH_RESULT_MS) openBeside(captureId);
  }, [query.data, expanded, openBeside, chatId, captureId, canInline]);
  return <section aria-label="Interactive app result" className={`${expanded ? 'h-full' : 'my-3 overflow-hidden rounded-xl border border-border'} flex flex-col bg-background`}>
    <div className={`${repeatsName ? 'hidden' : 'flex'} items-center gap-2 border-b border-border/60 px-3 py-2`}>
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{query.data?.title ?? 'Interactive result'}</span>
      {chatId && companion && !expanded && !moved && canExpand && <Button size="xs" variant="ghost" onClick={() => companion.open(captureId)}><PanelRightOpen size={13}/>Open beside chat</Button>}
      {onClose && <Button size="xs" variant="ghost" onClick={onClose}><X size={13}/>Close</Button>}
    </div>
    {moved && <p className="px-3 py-4 text-xs text-muted-foreground">Open beside this chat.{canInline && <> <button className="text-primary underline" onClick={() => companion?.open(null)}>Show inline</button></>}</p>}
    {!moved && !expanded && !canInline && <p className="px-3 py-4 text-xs text-muted-foreground">This app shows beside the chat.</p>}
    {/* A full-screen-only view still mounts here, hidden, so opening it beside the chat keeps its state. */}
    <div ref={setInlineMount} className={moved || (!expanded && !canInline) ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}/>
    {container && createPortal(failure ? <div role="alert" className="space-y-2 p-4 text-sm text-muted-foreground"><p>{failure.message}</p><p>Your original tool result is unchanged.</p><Button size="xs" variant="outline" onClick={() => {void query.refetch(); void access.refetch();}}>Check view again</Button></div>
      : query.data?.resource ? <MountedView key={query.data.id} view={query.data} expanded={expanded || !!moved} deepLink={deepLink} onExpand={mode => companion?.open(mode === 'inline' ? null : captureId)} />
      : query.data ? <div className="space-y-3 p-4 text-sm"><p className="text-muted-foreground">{query.data.unsupported ?? 'This result has no available interface.'}</p>{query.data.result.content.flatMap((item, index) => item.type === 'text' ? [<p key={index} className="whitespace-pre-wrap [overflow-wrap:anywhere]">{item.text}</p>] : [])}{query.data.result.structuredContent != null && <details><summary className="cursor-pointer text-xs text-muted-foreground">Result data</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(query.data.result.structuredContent, null, 2).slice(0, 64_000)}</pre></details>}<Button size="xs" variant="outline" onClick={() => void query.refetch()}>Check interface again</Button></div>
      : <p role="status" className="flex items-center gap-2 p-4 text-xs text-muted-foreground"><Loader2 size={14} className="animate-spin"/>Opening app…</p>, container)}
  </section>;
}
function MountedView({view, expanded, deepLink, onExpand}: {view: OpenView; expanded: boolean; deepLink?: string; onExpand: (mode: 'inline' | 'fullscreen' | 'pip') => void}) {
  const queryClient = useQueryClient();
  const mount = useRef<HTMLDivElement>(null);
  const controller = useRef<AppViewController | null>(null);
  const {resolvedTheme} = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [height, setHeight] = useState(420);
  const [pending, setPending] = useState<Pending | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const onExpandRef = useRef(onExpand);
  useEffect(() => { onExpandRef.current = onExpand; }, [onExpand]);
  // Where a file the app asks to open (`openai/files/open`) shows: beside this chat, or full screen.
  const companion = useConnectedCompanion();
  const dashboard = useOptionalDashboard();
  const places = useRef({companion, dashboard});
  useEffect(() => { places.current = {companion, dashboard}; }, [companion, dashboard]);
  const dashboardRef = useRef(dashboard);
  useEffect(() => { dashboardRef.current = dashboard; }, [dashboard]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 12_000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const resource = view.resource;
    const frame = mount.current;
    if (!frame || !resource) return;
    let disposed = false, revision = view.revision;
    // `resources/subscribe` on the opened file: a long poll per URI delivers `notifications/resources/updated`.
    const watching = new Map<string, AbortController>();
    // Where this view's model context goes: its chat, or for a global screen whichever chat its
    // person sends in next. A settings or preview window attaches nothing.
    const scope = view.chatId ?? (view.kind === 'global' ? null : undefined);
    const blocks = (context: unknown): ContextBlock[] | null => {
      const value = context as {content?: unknown; structuredContent?: unknown} | null | undefined;
      const content = Array.isArray(value?.content) ? value.content as ContextBlock[] : [];
      return content.length || value?.structuredContent !== undefined ? content : null;
    };
    let attached = blocks(view.modelContext) !== null;
    // Sends need the person working in this view (`AppMessageGate`).
    const gate = new AppMessageGate();
    const holdsFocus = () => frame.contains(document.activeElement) && document.hasFocus();
    const noteFocus = () => setTimeout(() => { if (frame.contains(document.activeElement)) gate.noteInteraction(); }, 0);
    const press = () => gate.noteInteraction();
    window.addEventListener('blur', noteFocus);
    frame.addEventListener('pointerdown', press, true);
    frame.addEventListener('focusin', press);
    let waiting: Pending | null = null;
    const ask = (request: Omit<Pending, 'finish'>, signal: AbortSignal) => new Promise<boolean>((resolve, reject) => {
      if (waiting) { reject(new Error('Answer the current app approval first')); return; }
      const abort = () => { waiting = null; setPending(null); reject(new Error('The app request was cancelled')); };
      if (signal.aborted) { abort(); return; }
      waiting = {...request, finish: approved => { signal.removeEventListener('abort', abort); waiting = null; setPending(null); resolve(approved); }};
      signal.addEventListener('abort', abort, {once: true}); setPending(waiting);
    });
    const host = new AppViewController(frame, {
      call: async (name, input, signal, meta) => {
        const invocationId = meta?.invocationId ?? crypto.randomUUID();
        const args = (input ?? {}) as Record<string, unknown>;
        return runConnectedInvocation({signal,
          invoke: () => trpcClient.connectedApps.invoke.mutate({viewId: view.id, name, args, invocationId}),
          approve: (ids, approve) => trpcClient.connectedApps.approval.mutate({viewId: view.id, ids, approve}),
          cancel: () => trpcClient.connectedApps.cancel.mutate({viewId: view.id, invocationId}),
          ask,
        });
      },
      context: async context => {
        if (scope !== undefined) selectConnectedContext(scope, view.id);
        const accepted = await trpcClient.connectedApps.context.mutate({viewId: view.id, context});
        revision = accepted.revision;
        attached = blocks(context) !== null;
        if (scope !== undefined) setConnectedContextContent(scope, view.id, blocks(context));
        let widgetState: unknown;
        if (view.legacy) {
          const text = (context as {content?: {type: string; text?: string}[]}).content?.find(item => item.type === 'text')?.text;
          if (text) {try {widgetState = JSON.parse(text);} catch { /* Ordinary model context has no widget state. */ }}
        }
        queryClient.setQueryData<OpenView>(['connected-app-view', view.captureId, view.chatId], previous => previous ? {...previous, revision, widgetState} : previous);
        return accepted.updateId ? {updateId: accepted.updateId} : undefined;
      },
      // OpenAI's model context extension: titled, thumbnailed and image context, each change named by an updateId.
      modelContext: true,
      contextLimit: 768 * 1024,
      // `resources/read` goes to this app's own server on its account, or to the file it opened.
      readResource: (params, signal) => trpcClient.connectedApps.readResource.mutate({viewId: view.id, uri: params.uri, ...(params._meta ? {meta: params._meta} : {})}, {signal}),
      // OpenAI's file entrypoint: watch and save the file this view opened, through Ri.
      subscribeResource: async uri => {
        if (watching.has(uri)) return;
        let known = (await trpcClient.connectedApps.files.subscribe.mutate({viewId: view.id, uri})).revision;
        const stop = new AbortController();
        watching.set(uri, stop);
        void (async () => {
          while (!stop.signal.aborted && !disposed) {
            try {
              const next = await trpcClient.connectedApps.files.changes.query({viewId: view.id, uri, revision: known}, {signal: stop.signal});
              if (!next.watching) break;
              if (next.revision > known) { known = next.revision; await host.resourceUpdated(uri); }
            } catch {
              if (stop.signal.aborted || disposed) break;
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          }
          if (watching.get(uri) === stop) watching.delete(uri);
        })();
      },
      unsubscribeResource: async uri => {
        watching.get(uri)?.abort();
        watching.delete(uri);
        await trpcClient.connectedApps.files.unsubscribe.mutate({viewId: view.id, uri});
      },
      writeResource: (params, signal) => trpcClient.connectedApps.files.write.mutate({viewId: view.id, ...params}, {signal}),
      openFile: async (path, signal) => {
        const target = await trpcClient.connectedApps.files.open.mutate({viewId: view.id, path}, {signal});
        const {companion: pane, dashboard: board} = places.current;
        if (target.kind === 'app') {
          const captureId = await launchConnectedFile({serverId: target.serverId, tool: target.tool, handle: target.handle, chatId: target.chatId, signal,
            ask: (request, wait) => ask({ids: request.ids, preview: request.preview}, wait)});
          showConnectedCapture({captureId, serverId: target.serverId, chatId: target.chatId}, {companion: pane, setActiveView: board?.setActiveView});
        } else if (target.kind === 'attachment') window.open(attachmentUrl(target.fileName), '_blank', 'noopener,noreferrer');
        else if (board) board.setActiveView({kind: 'agent', id: target.workspaceId, tab: 'files'});
        else window.location.assign(viewHref({kind: 'agent', id: target.workspaceId, tab: 'files'}));
      },
      navigate: () => { throw new Error('This app does not provide internal navigation'); },
      externalLink: url => { window.open(url, '_blank', 'noopener,noreferrer'); },
      error: error => { if (!disposed) setError(error.message); },
      ready: () => { if (!disposed) setReady(true); },
      resize: value => { if (!disposed) setHeight(value); },
      // OpenAI's `ui/message` extension: rich content, to this chat or a new one, sent only while
      // the person works in the view (docs/connected-mcp-apps.md, "Messages"). Otherwise a draft.
      sendMessage: async (message, signal) => {
        let send = message.send, refusal: GateRefusal | undefined;
        if (send) {
          const decision = gate.decide(holdsFocus());
          if (!decision.send) { send = false; refusal = decision.reason; }
        }
        const parts = await appMessageParts(message.content, (file, name) => uploadAttachment(file, name));
        if (signal.aborted) throw new Error('The app message was cancelled');
        const chatId = await routeAppMessage(view.chatId, message.target, appMessageRouting(queryClient, dashboardRef.current));
        const delivery = await requestAppChatMessage(chatId, {parts, send, fromApp: {viewId: view.id, app: view.app}});
        if (disposed) return;
        if (refusal) setNotice(draftNotice(view.app, refusal));
        else if (send && delivery === 'drafted') setNotice(draftNotice(view.app, 'failed'));
      },
      ...(view.chatId ? {displayMode: (mode: 'inline' | 'fullscreen' | 'pip') => onExpandRef.current(mode)} : {}),
    });
    controller.current = host;
    // Removing the app's group in the composer drops its context here and tells the app (`openai/modelContext: null`).
    const clear = async () => {
      const cleared = await trpcClient.connectedApps.clearContext.mutate({viewId: view.id});
      revision = cleared.revision;
      attached = false;
      if (scope !== undefined) setConnectedContextContent(scope, view.id, null);
      host.hostContextChanged({'openai/modelContext': null});
    };
    const unregister = scope !== undefined ? registerConnectedContext(scope, view.id, async () => {
      await host.flushContext();
      return revision && attached ? {viewId: view.id, revision} : undefined;
    }, {app: view.app, clear, content: blocks(view.modelContext)}) : undefined;
    if (scope !== undefined && expanded && revision && attached) selectConnectedContext(scope, view.id);
    void host.open(resource, {id: view.id, packageDigest: resource.digest, path: '/', query: {}, initialData: null,
      theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light', mcp: {input: view.input, result: view.result, widgetState: view.widgetState}, displayMode: expanded ? 'fullscreen' : 'inline',
      displayModes: resource.displayModes.available, platform: 'web', fileResource: view.kind === 'file',
      hostContext: {
        // OpenAI's host state: where a global screen opens, and the context this view attached before a remount.
        ...(deepLink ?? view.deepLink ? {'openai/deepLink': {url: deepLink ?? view.deepLink}} : {}),
        'openai/modelContext': view.modelContext,
      }}).catch(e => setError(e.message));
    const timer = setTimeout(() => { if (!disposed) setReady(current => { if (!current) setError('The app did not connect to Ri’s UI bridge. Its tools and text results are still available.'); return current; }); }, 20_000);
    return () => {
      disposed = true; clearTimeout(timer); unregister?.(); waiting?.finish(false); controller.current = null;
      for (const [uri, stop] of watching) { stop.abort(); void trpcClient.connectedApps.files.unsubscribe.mutate({viewId: view.id, uri}).catch(() => {}); }
      void host.dispose();
      window.removeEventListener('blur', noteFocus); frame.removeEventListener('pointerdown', press, true); frame.removeEventListener('focusin', press);
    };
    // The capture is immutable. Refetch checks access without rebuilding the iframe.
  }, [view.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => controller.current?.theme(resolvedTheme === 'dark' ? 'dark' : 'light'), [resolvedTheme]);
  // A deep link to this open screen moves it in place (OpenAI's deep links), and is kept for a remount.
  const sentLink = useRef(deepLink ?? view.deepLink);
  useEffect(() => {
    if (!deepLink || view.kind !== 'global' || sentLink.current === deepLink) return;
    sentLink.current = deepLink;
    controller.current?.hostContextChanged({'openai/deepLink': {url: deepLink}});
    void trpcClient.connectedApps.navigate.mutate({viewId: view.id, deepLink}).catch(error => setError(error instanceof Error ? error.message : 'The link could not open'));
  }, [deepLink, view.id, view.kind]);
  useEffect(() => controller.current?.displayMode(expanded ? 'fullscreen' : 'inline'), [expanded]);
  return <div className="relative flex min-h-0 flex-1 flex-col">
    {pending && <div className="space-y-2 border-b border-amber-500/30 bg-amber-500/10 p-3 text-xs"><p className="font-medium">Allow this app operation?</p><pre className="max-h-32 overflow-auto whitespace-pre-wrap">{JSON.stringify(pending.preview, null, 2)}</pre><div className="flex gap-2"><Button size="xs" onClick={() => pending.finish(true)}>Allow once</Button><Button size="xs" variant="outline" onClick={() => pending.finish(false)}>Decline</Button></div></div>}
    {error && <p role="alert" className="border-b border-border p-3 text-xs text-destructive">{error}</p>}
    {notice && <p role="status" className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground"><span className="min-w-0 flex-1">{notice}</span><button type="button" className="shrink-0 hover:text-foreground" onClick={() => setNotice(null)}>Dismiss</button></p>}
    {!ready && !error && <p role="status" className="absolute left-3 top-3 text-xs text-muted-foreground">Loading interface…</p>}
    <ConnectedViewForms viewId={view.id} />
    {/* Inline, the frame is exactly the height the view reports (the host clamps it to 160 to 900 px), capped
        at 80% of the window, and the view scrolls inside only past that. It must not flex: a 0% flex basis in an
        auto-height column resolves to this empty div's content, which collapsed every view to its minimum. */}
    <div ref={mount} style={expanded ? undefined : {height, maxHeight: 'min(900px, 80vh)'}} className={expanded ? 'min-h-[240px] flex-1' : 'shrink-0'}/>
  </div>;
}
