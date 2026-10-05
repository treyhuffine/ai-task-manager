'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, PanelsTopLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { trpc } from '@/lib/trpc/client';
import { EvaluationChat } from './evaluation-chat';

export function InteractiveExamples() {
  const status = useQuery(trpc.pluginEvaluation.status.queryOptions());
  const launch = useMutation(trpc.pluginEvaluation.launch.mutationOptions());
  const [view, setView] = useState<{ url: string; expiresAt: string } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed' | 'ended'>('loading');
  const [generation, setGeneration] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const launchButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!view) return;
    const timer = window.setTimeout(() => setState(previous => previous === 'loading' ? 'failed' : previous), 20000);
    const expiry = window.setTimeout(() => setState('ended'), Math.max(0, Date.parse(view.expiresAt) - Date.now()));
    function onMessage(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow || event.origin !== new URL(view!.url).origin) return;
      if (event.data?.kind === 'ri-evaluation-ready') setState('ready');
    }
    window.addEventListener('message', onMessage);
    return () => { window.clearTimeout(timer); window.clearTimeout(expiry); window.removeEventListener('message', onMessage); };
  }, [view]);

  async function open() {
    try {
      const next = await launch.mutateAsync({ parentOrigin: window.location.origin });
      setState('loading');
      setView(next);
    } catch { /* The mutation's error is displayed in the card. */ }
  }

  if (!status.data?.available) return null;
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/20 p-4">
        <PanelsTopLeft className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Interactive examples <span className="ml-1 text-xs font-normal text-muted-foreground">Experimental</span></p>
          <p className="mt-1 text-xs text-muted-foreground">Try hosted diagrams, charts and public building data, or chat with the sample scenario. Uses a temporary view session.</p>
          {launch.error && <p role="alert" className="mt-2 text-xs text-destructive">{launch.error.message}</p>}
        </div>
        <Button ref={launchButton} variant="outline" size="sm" disabled={launch.isPending} onClick={() => void open()}>
          {launch.isPending ? 'Opening…' : 'Try interactive examples'}
        </Button>
      </div>
      <Dialog open={!!view} onOpenChange={open => { if (!open) setView(null); }}>
        <DialogContent onCloseAutoFocus={event => { event.preventDefault(); launchButton.current?.focus(); }} className="flex h-[92dvh] w-[calc(100%-1rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-[calc(100%-2rem)]">
          <DialogHeader className="border-b border-border px-4 py-3 pr-12 text-left">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => setView(null)}><ArrowLeft className="size-4" />Return to Plugins</Button>
              <DialogTitle className="text-sm">Interactive examples</DialogTitle>
            </div>
            <DialogDescription className="px-2 text-xs">Sample inputs and public data from external services. Closing or reloading ends this view. Your conversation stays in Ri.</DialogDescription>
          </DialogHeader>
          {state === 'loading' && <p role="status" className="px-6 py-2 text-xs text-muted-foreground">Connecting to the examples…</p>}
          {(state === 'failed' || state === 'ended') ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
              <p role="status" className="text-sm">{state === 'ended' ? 'Example session ended.' : 'The examples could not load. Your conversation is still available.'}</p>
              <Button variant="outline" onClick={() => { setView(null); void open(); }}>Open a new example session</Button>
            </div>
          ) : view && <iframe ref={frame} title="Interactive plugin examples" src={view.url} onLoad={() => setGeneration(previous => previous + 1)} sandbox="allow-scripts allow-same-origin" referrerPolicy="origin" className="min-h-0 w-full flex-1 border-0 bg-background" />}
          {view && state === 'ready' && <EvaluationChat key={`${view.url}:${generation}`} viewUrl={view.url} frame={frame} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
