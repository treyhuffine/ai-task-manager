'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { trpc, trpcClient } from '@/lib/trpc/client';
import type { ResourceOption } from '@/lib/mcp-apps/form-schema';
import { ConnectedView } from '../view';

/**
 * Expanded details for a resource option (OpenAI's `openai/preview`). A
 * resource link shows the linked resource, read from the asking server. An
 * app tool opens that server's app with the arguments the form named,
 * through the same approval gate as opening any app.
 */
export function FormPreview({formId, chatId, option, onClose}: {formId: string; chatId: string | null; option: ResourceOption; onClose: () => void}) {
  const title = option.title ?? option.name;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className={option.preview?.type === 'mcp_app_tool' ? 'flex h-[min(85vh,760px)] max-w-4xl flex-col' : 'max-w-2xl'}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {option.description && <DialogDescription>{option.description}</DialogDescription>}
      </DialogHeader>
      {option.preview?.type === 'resource_link'
        ? <ResourcePreview formId={formId} uri={option.preview.uri} />
        : option.preview?.type === 'mcp_app_tool'
          ? <AppPreview formId={formId} chatId={chatId} name={option.preview.name} args={option.preview.arguments} title={title} />
          : null}
    </DialogContent>
  </Dialog>;
}

function ResourcePreview({formId, uri}: {formId: string; uri: string}) {
  const query = useQuery(trpc.connectedApps.forms.preview.queryOptions({formId, uri}, {retry: false, staleTime: 60_000}));
  if (query.isPending) return <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin" />Loading preview…</p>;
  if (query.error) return <p role="alert" className="text-xs text-destructive">{query.error.message}</p>;
  return <div className="max-h-[60vh] space-y-3 overflow-auto">{query.data.contents.map((item, index) => {
    if (item.text !== undefined) return <pre key={index} className="whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-xs [overflow-wrap:anywhere]">{item.text}</pre>;
    if (item.blob && item.mimeType?.startsWith('image/') && item.mimeType !== 'image/svg+xml') {
      // eslint-disable-next-line @next/next/no-img-element -- a server's preview image, inlined as data
      return <img key={index} src={`data:${item.mimeType};base64,${item.blob}`} alt="" className="max-h-[55vh] w-full rounded-md object-contain" />;
    }
    return <p key={index} className="text-xs text-muted-foreground">This preview is a {item.mimeType ?? 'binary'} file, which Ri does not show here.</p>;
  })}</div>;
}

type Step = { kind: 'opening' } | { kind: 'approval'; viewId: string; invocationId: string; ids: string[]; preview?: unknown } | { kind: 'open'; captureId: string } | { kind: 'error'; message: string };

function AppPreview({formId, chatId, name, args, title}: {formId: string; chatId: string | null; name: string; args: Record<string, unknown>; title: string}) {
  const [step, setStep] = useState<Step>({kind: 'opening'});
  const pending = useRef<{viewId: string; invocationId: string} | null>(null);
  const alive = useRef(true);
  const launch = async (request: {viewId: string; invocationId: string}) => {
    pending.current = request;
    const result = await trpcClient.connectedApps.launch.mutate({viewId: request.viewId});
    if (!alive.current) return;
    if (result.kind === 'approval') { setStep({kind: 'approval', ...request, ids: result.ids, preview: result.preview}); return; }
    pending.current = null;
    setStep({kind: 'open', captureId: result.captureId});
  };
  useEffect(() => {
    alive.current = true;
    void (async () => {
      try {
        const prepared = await trpcClient.connectedApps.forms.openPreview.mutate({formId, name, args});
        if (!alive.current) return;
        if (prepared.kind === 'open') setStep({kind: 'open', captureId: prepared.captureId});
        else await launch({viewId: prepared.viewId, invocationId: prepared.invocationId});
      } catch (error) { if (alive.current) setStep({kind: 'error', message: error instanceof Error ? error.message : 'The preview could not open.'}); }
    })();
    return () => {
      alive.current = false;
      // Closing the preview cancels an operation still waiting on approval.
      if (pending.current) void trpcClient.connectedApps.cancel.mutate(pending.current).catch(() => {});
    };
    // The preview opens once per dialog.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const decide = async (approve: boolean) => {
    if (step.kind !== 'approval') return;
    try {
      await trpcClient.connectedApps.approval.mutate({viewId: step.viewId, ids: step.ids, approve});
      if (!approve) { await trpcClient.connectedApps.cancel.mutate({viewId: step.viewId, invocationId: step.invocationId}); pending.current = null; setStep({kind: 'error', message: 'The preview did not open.'}); return; }
      setStep({kind: 'opening'});
      await launch({viewId: step.viewId, invocationId: step.invocationId});
    } catch (error) { setStep({kind: 'error', message: error instanceof Error ? error.message : 'The decision could not be saved.'}); }
  };
  if (step.kind === 'open') return <div className="flex min-h-0 flex-1 flex-col"><ConnectedView captureId={step.captureId} chatId={chatId ?? undefined} expanded appName={title} /></div>;
  if (step.kind === 'opening') return <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={13} className="animate-spin" />Opening preview…</p>;
  if (step.kind === 'error') return <p role="alert" className="text-xs text-destructive">{step.message}</p>;
  return <div role="group" aria-label="Allow this preview to open" className="space-y-3 rounded-xl bg-amber-500/10 p-4 text-sm">
    <p>Allow this app to open the preview?</p>
    {step.preview != null && <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(step.preview, null, 2)}</pre>}
    <div className="flex gap-2"><Button size="sm" onClick={() => void decide(true)}>Allow once</Button><Button size="sm" variant="ghost" onClick={() => void decide(false)}>Decline</Button></div>
  </div>;
}
