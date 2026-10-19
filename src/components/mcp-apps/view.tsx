'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppViewController } from '@ri/mcp-apps-host';
import { Loader2, PanelRightOpen } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { trpcClient } from '@/lib/trpc/client';
import type { RouterOutputs } from '@/lib/trpc/router';
import { registerConnectedContext, selectConnectedContext } from '@/lib/client/mcp-app-context';
import { requestAppChatDraft } from '@/lib/client/app-chat-intent';
import { useConnectedCompanion } from '@/lib/client/mcp-app-panel';
import { runConnectedInvocation } from '@/lib/client/mcp-app-invocation';

type OpenView = RouterOutputs['connectedApps']['open'];
type Pending = {ids: string[]; preview?: unknown; finish: (approve: boolean) => void};
export function ConnectedView({captureId, chatId, expanded = false}: {captureId: string; chatId?: string; expanded?: boolean}) {
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
  return <section aria-label="Interactive app result" className={`${expanded ? 'h-full' : 'my-3 overflow-hidden rounded-xl border border-border'} flex flex-col bg-background`}>
    <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{query.data?.title ?? 'Interactive result'}</span>
      {chatId && companion && !expanded && !moved && <Button size="xs" variant="ghost" onClick={() => companion.open(captureId)}><PanelRightOpen size={13}/>Open beside chat</Button>}
    </div>
    {moved && <p className="px-3 py-4 text-xs text-muted-foreground">Open beside this chat. <button className="text-primary underline" onClick={() => companion?.open(null)}>Show inline</button></p>}
    <div ref={setInlineMount} className={moved ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}/>
    {container && createPortal(failure ? <div role="alert" className="space-y-2 p-4 text-sm text-muted-foreground"><p>{failure.message}</p><p>Your original tool result is unchanged.</p><Button size="xs" variant="outline" onClick={() => {void query.refetch(); void access.refetch();}}>Check view again</Button></div>
      : query.data?.resource ? <MountedView key={query.data.id} view={query.data} expanded={expanded || !!moved} onExpand={mode => companion?.open(mode === 'inline' ? null : captureId)} />
      : query.data ? <div className="space-y-3 p-4 text-sm"><p className="text-muted-foreground">{query.data.unsupported ?? 'This result has no available interface.'}</p>{query.data.result.content.flatMap((item, index) => item.type === 'text' ? [<p key={index} className="whitespace-pre-wrap [overflow-wrap:anywhere]">{item.text}</p>] : [])}{query.data.result.structuredContent != null && <details><summary className="cursor-pointer text-xs text-muted-foreground">Result data</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(query.data.result.structuredContent, null, 2).slice(0, 64_000)}</pre></details>}<Button size="xs" variant="outline" onClick={() => void query.refetch()}>Check interface again</Button></div>
      : <p role="status" className="flex items-center gap-2 p-4 text-xs text-muted-foreground"><Loader2 size={14} className="animate-spin"/>Opening app…</p>, container)}
  </section>;
}
function MountedView({view, expanded, onExpand}: {view: OpenView; expanded: boolean; onExpand: (mode: 'inline' | 'fullscreen' | 'pip') => void}) {
  const queryClient = useQueryClient();
  const mount = useRef<HTMLDivElement>(null);
  const controller = useRef<AppViewController | null>(null);
  const {resolvedTheme} = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [height, setHeight] = useState(420);
  const [pending, setPending] = useState<Pending | null>(null);
  const [ready, setReady] = useState(false);
  const onExpandRef = useRef(onExpand);
  useEffect(() => { onExpandRef.current = onExpand; }, [onExpand]);
  useEffect(() => {
    const resource = view.resource;
    if (!mount.current || !resource) return;
    let disposed = false, revision = view.revision;
    let waiting: Pending | null = null;
    const ask = (request: Omit<Pending, 'finish'>, signal: AbortSignal) => new Promise<boolean>((resolve, reject) => {
      if (waiting) { reject(new Error('Answer the current app approval first')); return; }
      const abort = () => { waiting = null; setPending(null); reject(new Error('The app request was cancelled')); };
      if (signal.aborted) { abort(); return; }
      waiting = {...request, finish: approved => { signal.removeEventListener('abort', abort); waiting = null; setPending(null); resolve(approved); }};
      signal.addEventListener('abort', abort, {once: true}); setPending(waiting);
    });
    const host = new AppViewController(mount.current, {
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
        if (view.chatId) selectConnectedContext(view.chatId, view.id);
        revision = await trpcClient.connectedApps.context.mutate({viewId: view.id, context});
        let widgetState: unknown;
        if (view.legacy) {
          const text = (context as {content?: {type: string; text?: string}[]}).content?.find(item => item.type === 'text')?.text;
          if (text) {try {widgetState = JSON.parse(text);} catch { /* Ordinary model context has no widget state. */ }}
        }
        queryClient.setQueryData<OpenView>(['connected-app-view', view.captureId, view.chatId], previous => previous ? {...previous, revision, widgetState} : previous);
      },
      navigate: () => { throw new Error('This app does not provide internal navigation'); },
      externalLink: url => { window.open(url, '_blank', 'noopener,noreferrer'); },
      error: error => { if (!disposed) setError(error.message); },
      ready: () => { if (!disposed) setReady(true); },
      resize: value => { if (!disposed) setHeight(value); },
      ...(view.chatId ? {message: (text: string) => requestAppChatDraft(view.chatId!, text), displayMode: (mode: 'inline' | 'fullscreen' | 'pip') => onExpandRef.current(mode)} : {}),
    });
    controller.current = host;
    const unregister = view.chatId ? registerConnectedContext(view.chatId, view.id, async () => { await host.flushContext(); return revision ? {viewId: view.id, revision} : undefined; }) : undefined;
    if (view.chatId && expanded && revision) selectConnectedContext(view.chatId, view.id);
    void host.open(resource, {id: view.id, packageDigest: resource.digest, path: '/', query: {}, initialData: null,
      theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light', mcp: {input: view.input, result: view.result, widgetState: view.widgetState}, displayMode: expanded ? 'fullscreen' : 'inline'}).catch(e => setError(e.message));
    const timer = setTimeout(() => { if (!disposed) setReady(current => { if (!current) setError('The app did not connect to Ri’s UI bridge. Its tools and text results are still available.'); return current; }); }, 20_000);
    return () => { disposed = true; clearTimeout(timer); unregister?.(); waiting?.finish(false); controller.current = null; void host.dispose(); };
    // The capture is immutable. Refetch checks access without rebuilding the iframe.
  }, [view.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => controller.current?.theme(resolvedTheme === 'dark' ? 'dark' : 'light'), [resolvedTheme]);
  useEffect(() => controller.current?.displayMode(expanded ? 'fullscreen' : 'inline'), [expanded]);
  return <div className="relative flex min-h-0 flex-1 flex-col">
    {pending && <div className="space-y-2 border-b border-amber-500/30 bg-amber-500/10 p-3 text-xs"><p className="font-medium">Allow this app operation?</p><pre className="max-h-32 overflow-auto whitespace-pre-wrap">{JSON.stringify(pending.preview, null, 2)}</pre><div className="flex gap-2"><Button size="xs" onClick={() => pending.finish(true)}>Allow once</Button><Button size="xs" variant="outline" onClick={() => pending.finish(false)}>Decline</Button></div></div>}
    {error && <p role="alert" className="border-b border-border p-3 text-xs text-destructive">{error}</p>}
    {!ready && !error && <p role="status" className="absolute left-3 top-3 text-xs text-muted-foreground">Loading interface…</p>}
    <div ref={mount} style={{height: expanded ? '100%' : height, minHeight: 240}} className="min-h-0 flex-1"/>
  </div>;
}
