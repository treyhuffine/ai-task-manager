'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tip';
import { useElementWidth } from '@/hooks/use-element-width';
import { launchConnectedApp, LaunchDeclined, type LaunchApproval } from '@/lib/client/mcp-app-launch';
import { ConnectedView } from './view';
import { EntrypointIcon } from './entrypoint-icon';
import { canMoveLiveViews, ConnectedCompanionContext, mayPlaceResult, type ConnectedTab } from '@/lib/client/mcp-app-panel';

type Opening = {tab: ConnectedTab; approval?: LaunchApproval & {answer: (approve: boolean) => void}; error?: string};

/**
 * The pane beside a chat for connected apps: a model result expanded out of
 * the transcript, or an app's thread tab (OpenAI's thread entrypoint). A tab
 * opens with `{}` through the approval gate, once per chat: opening it again
 * returns to the same instance (docs/connected-mcp-apps.md, "Instances").
 */
export function ConnectedCompanion({chatId, children}: {chatId: string; children: (open: boolean) => React.ReactNode}) {
  const [captureId, setCaptureId] = useState<string | null>(null);
  const [tab, setTab] = useState<ConnectedTab | null>(null);
  const [opening, setOpening] = useState<Opening | null>(null);
  const [mount, setMount] = useState<HTMLDivElement | null>(null);
  const [inlineIds, setInlineIds] = useState<Set<string>>(() => new Set());
  // The result a display mode placed here. The next such result may replace it. Nothing else may.
  const [placedId, setPlacedId] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const register = useCallback((id: string) => {
    setInlineIds(previous => new Set([...previous, id]));
    return () => setInlineIds(previous => {const next = new Set(previous); next.delete(id); return next;});
  }, []);
  const stopOpening = useCallback(() => { abort.current?.abort(); abort.current = null; setOpening(null); }, []);
  useEffect(() => () => abort.current?.abort(), []);
  const open = useCallback((id: string | null) => { stopOpening(); setTab(null); setCaptureId(id); setPlacedId(null); }, [stopOpening]);
  const place = useCallback((id: string) => {
    if (!mayPlaceResult({captureId, tab, opening: !!opening, placedId, canMove: canMoveLiveViews()})) return;
    setCaptureId(id); setPlacedId(id);
  }, [captureId, tab, opening, placedId]);
  const openTab = useCallback(async (next: ConnectedTab, options: {fresh?: boolean} = {}) => {
    stopOpening();
    const controller = new AbortController();
    abort.current = controller;
    setOpening({tab: next});
    try {
      const opened = await launchConnectedApp({serverId: next.serverId, name: next.name, kind: 'thread', chatId, ...(options.fresh ? {fresh: true} : {})},
        approval => new Promise<boolean>(resolve => setOpening(current => current && {...current, approval: {...approval, answer: resolve}})),
        {signal: controller.signal});
      if (controller.signal.aborted) return;
      abort.current = null;
      setOpening(null); setTab(next); setCaptureId(opened.captureId); setPlacedId(null);
    } catch (error) {
      if (controller.signal.aborted) return;
      abort.current = null;
      if (error instanceof LaunchDeclined) { setOpening(null); return; }
      setOpening({tab: next, error: error instanceof Error ? error.message : 'The app could not open'});
    }
  }, [chatId, stopOpening]);
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const side = width === null || width >= 820;
  const visible = !!captureId || !!opening;
  const close = () => { stopOpening(); setTab(null); setCaptureId(null); setPlacedId(null); };
  return <ConnectedCompanionContext.Provider value={{chatId, captureId, open, place, mount, register, tab, openTab}}><div ref={ref} className={`flex min-h-0 min-w-0 flex-1 ${side ? 'flex-row' : 'flex-col'}`}>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children(visible)}</div>
    <aside aria-label="Connected app beside this chat" className={`${visible ? 'flex' : 'hidden'} min-h-0 flex-col bg-background ${side ? 'w-[min(45%,640px)] border-l' : 'h-[50%] border-t'} border-border`}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
        {(opening?.tab ?? tab) && <EntrypointIcon icons={(opening?.tab ?? tab)!.icons} size={14}/>}
        <span className="min-w-0 flex-1 truncate">{(opening?.tab ?? tab)?.title ?? 'App beside this chat'}</span>
        {tab && !opening && <Tip label="Start this tab over"><button aria-label={`Reload ${tab.title}`} onClick={() => void openTab(tab, {fresh: true})} className="rounded p-1 hover:bg-muted"><RotateCcw size={13}/></button></Tip>}
        <button aria-label="Close app" onClick={close} className="rounded p-1 hover:bg-muted"><X size={14}/></button>
      </div>
      {opening && <TabStatus opening={opening} onRetry={() => void openTab(opening.tab)} onClose={close}/>}
      {/* What the pane shows stays mounted, hidden, while a tab opens: declined, or the same tab returned to, it is just as the person left it. */}
      <div ref={setMount} className={`${opening ? 'hidden' : ''} min-h-0 flex-1 overflow-auto`}>{captureId && !inlineIds.has(captureId) && <ConnectedView key={captureId} captureId={captureId} chatId={chatId} expanded titled={!!tab}/>}</div>
    </aside>
  </div></ConnectedCompanionContext.Provider>;
}

/** A tab that is opening: progress, the approval its tool needs, or why it could not open. */
function TabStatus({opening, onRetry, onClose}: {opening: Opening; onRetry: () => void; onClose: () => void}) {
  const {tab, approval, error} = opening;
  return <div className="flex flex-1 items-center justify-center p-6 text-sm">
    {error ? <div role="alert" className="space-y-3 text-center">
      <p className="font-medium">{tab.title} could not open</p>
      <p className="whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{error}</p>
      <div className="flex justify-center gap-2"><Button size="xs" variant="outline" onClick={onRetry}>Try again</Button><Button size="xs" variant="ghost" onClick={onClose}>Close</Button></div>
    </div> : approval ? <div role="group" aria-label={`Allow ${tab.title} to open`} className="w-full max-w-sm space-y-3 rounded-xl bg-amber-500/10 p-4">
      <p>Allow {tab.title} to open beside this chat?</p>
      {approval.preview != null && <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(approval.preview, null, 2)}</pre>}
      <div className="flex gap-2"><Button size="xs" onClick={() => approval.answer(true)}>Allow once</Button><Button size="xs" variant="ghost" onClick={() => approval.answer(false)}>Decline</Button></div>
    </div> : <p role="status" className="flex items-center gap-2 text-muted-foreground"><Loader2 size={14} className="animate-spin"/>Opening {tab.title}…</p>}
  </div>;
}

