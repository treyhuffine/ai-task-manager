'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, PanelsTopLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { EvaluationChat } from './evaluation-chat';
import { PLUGIN_DEMOS, ACCOUNT_DEMOS } from '@/lib/plugins/demo-catalog';
import { openSettings } from '@/components/settings/settings-store';
import { AccountEvaluationBridge } from './account-evaluation-bridge';

export function InteractiveExamples() {
  const status = useQuery(trpc.pluginEvaluation.status.queryOptions());
  const launch = useMutation(trpc.pluginEvaluation.launch.mutationOptions());
  const accounts = useQuery({ ...trpc.pluginEvaluation.accounts.queryOptions(), refetchOnWindowFocus: 'always', refetchInterval: 15000 });
  const launchAccount = useMutation(trpc.pluginEvaluation.launchAccount.mutationOptions());
  const [selectedAccounts, setSelectedAccounts] = useState<Record<string, string>>({});
  const [view, setView] = useState<{ url: string; expiresAt: string; handle?: string; account?: string } | null>(null);
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
    return () => {
      window.clearTimeout(timer); window.clearTimeout(expiry); window.removeEventListener('message', onMessage);
      if (view.handle) void trpcClient.pluginEvaluation.endAccount.mutate({ handle: view.handle }).catch(() => {});
    };
  }, [view]);

  async function open(example?: 'excalidraw' | 'flint' | 'buildings' | 'tldraw', serverId?: string) {
    try {
      const next = serverId ? await launchAccount.mutateAsync({ parentOrigin: window.location.origin, serverId })
        : await launch.mutateAsync({ parentOrigin: window.location.origin, ...(example ? { example } : {}) });
      setState('loading');
      setView(next);
    } catch { /* The mutation's error is displayed in the card. */ }
  }

  return (
    <>
      <div className="mb-5 space-y-4 rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <PanelsTopLeft className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Interactive examples <span className="ml-1 text-xs font-normal text-muted-foreground">Experimental</span></p>
          <p className="mt-1 text-xs text-muted-foreground">Open four public demos. Connect Asana, Figma or PostHog to discover the interactive views available to your account.</p>
          {launch.error && <p role="alert" className="mt-2 text-xs text-destructive">{launch.error.message}</p>}
          {launchAccount.error && <p role="alert" className="mt-2 text-xs text-destructive">{launchAccount.error.message}</p>}
        </div>
        <Button ref={launchButton} variant="outline" size="sm" disabled={launch.isPending || !status.data?.available} onClick={() => void open()}>
          {launch.isPending ? 'Opening…' : 'Try interactive examples'}
        </Button>
      </div>
      {!status.data?.available && <p role="status" className="text-xs text-muted-foreground">The interactive host is offline on your Home computer. Account setup is still available.</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs" aria-label="Interactive plugin demos">
          <thead><tr className="border-b border-border text-muted-foreground"><th className="pb-2 pr-3 font-medium">Plugin</th><th className="pb-2 pr-3 font-medium">What you can try</th><th className="pb-2 font-medium">Access and actions</th></tr></thead>
          <tbody>{PLUGIN_DEMOS.map(demo => {
            const needsAccount = ACCOUNT_DEMOS.includes(demo.id as typeof ACCOUNT_DEMOS[number]);
            const choices = accounts.data?.filter(account => account.providerId === demo.id) ?? [];
            const selected = choices.find(account => account.serverId === selectedAccounts[demo.id]) ?? (choices.length === 1 ? choices[0] : undefined);
            return <tr key={demo.id} className="border-b border-border/50 last:border-0">
              <th className="py-3 pr-3 align-top font-medium"><a href={demo.source} target="_blank" rel="noopener noreferrer" className="hover:underline">{demo.name}</a></th>
              <td className="min-w-40 py-3 pr-3 align-top text-muted-foreground">{demo.description}</td>
              <td className="min-w-44 space-y-2 py-3 align-top">
                <p className="text-muted-foreground">{demo.access}</p>
                {needsAccount && choices.length > 1 && <select aria-label={`${demo.name} account`} value={selectedAccounts[demo.id] ?? ''} onChange={event => setSelectedAccounts(previous => ({ ...previous, [demo.id]: event.target.value }))} className="max-w-full rounded border border-input bg-background p-1"><option value="">Choose account</option>{choices.map(value => <option key={value.serverId} value={value.serverId}>{value.label}</option>)}</select>}
                {needsAccount && selected && <p role="status" className="text-[11px] text-muted-foreground">{selected.label}: {selected.status}</p>}
                <div className="flex flex-wrap gap-1">
                  {needsAccount ? <>
                    <Button size="xs" variant="outline" onClick={() => openSettings('plugins', { anchor: `connectors:${demo.id}` })}>{choices.length ? 'Manage accounts' : 'Connect account'}</Button>
                    <Button size="xs" disabled={!status.data?.available || !selected?.available || !selected.interactiveTools || launchAccount.isPending} onClick={() => void open(undefined, selected?.serverId)}>Try interactive view</Button>
                  </> : <Button size="xs" variant="outline" disabled={!status.data?.available || launch.isPending} onClick={() => void open(demo.id as 'excalidraw' | 'flint' | 'buildings' | 'tldraw')}>Open demo</Button>}
                </div>
                {demo.id === 'figma' && <p className="text-[11px] text-muted-foreground">Ri client approval and UI discovery are checked separately.</p>}
              </td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {accounts.error && <p role="alert" className="text-xs text-destructive">Account status could not load. Use Manage accounts to check your connection.</p>}
      </div>
      <Dialog open={!!view} onOpenChange={open => { if (!open) setView(null); }}>
        <DialogContent onCloseAutoFocus={event => { event.preventDefault(); launchButton.current?.focus(); }} className="flex h-[92dvh] w-[calc(100%-1rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-[calc(100%-2rem)]">
          <DialogHeader className="border-b border-border px-4 py-3 pr-12 text-left">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => setView(null)}><ArrowLeft className="size-4" />Return to Plugins</Button>
              <DialogTitle className="text-sm">Interactive examples</DialogTitle>
            </div>
            <DialogDescription className="px-2 text-xs">{view?.account ? `Selected account: ${view.account}. App actions use your current access and approvals.` : 'Sample inputs and public data from external services.'} Closing or reloading ends this view. Your conversation stays in Ri.</DialogDescription>
          </DialogHeader>
          {state === 'loading' && <p role="status" className="px-6 py-2 text-xs text-muted-foreground">Connecting to the examples…</p>}
          {(state === 'failed' || state === 'ended') ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
              <p role="status" className="text-sm">{state === 'ended' ? 'Example session ended.' : 'The examples could not load. Your conversation is still available.'}</p>
              <Button variant="outline" onClick={() => { setView(null); void open(); }}>Open a new example session</Button>
            </div>
          ) : view && <iframe ref={frame} title="Interactive plugin examples" src={view.url} onLoad={() => setGeneration(previous => previous + 1)} sandbox="allow-scripts allow-same-origin" referrerPolicy="origin" className="min-h-0 w-full flex-1 border-0 bg-background" />}
          {view?.handle && <AccountEvaluationBridge key={view.handle} handle={view.handle} url={view.url} account={view.account!} frame={frame} />}
          {view && state === 'ready' && <EvaluationChat key={`${view.url}:${generation}`} viewUrl={view.url} frame={frame} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
