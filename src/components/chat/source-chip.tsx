'use client';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Editor } from '@tiptap/core';
import { AppWindow, MessageCircle, X } from 'lucide-react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tip';
import { openSettings } from '@/components/settings/settings-store';
import { trpcClient } from '@/lib/trpc/client';
import { SOURCE_STATUS_LABELS, type SourceDescriptor } from '@/lib/chat-sources/types';
import { parseSourceMarkers } from '@/lib/chat-sources/reference';

const SourceContext = createContext<{ chatId?: string; sources: SourceDescriptor[] }>({ sources: [] });
export function SourceMetadataProvider({ chatId, refs, children }: { chatId?: string; refs: string[]; children: ReactNode }) {
  const stable = [...new Set(refs)].sort().slice(0, 16);
  const query = useQuery({
    queryKey: ['chat-sources', 'resolve', chatId, stable],
    queryFn: ({ signal }) => trpcClient.chatSources.resolve.query({ chatId: chatId!, refs: stable }, { signal }),
    enabled: !!chatId && stable.length > 0,
    staleTime: 0, refetchInterval: 10_000,
  });
  const queryClient = useQueryClient();
  useEffect(() => queryClient.getQueryCache().subscribe(event => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    const root = event.query.queryKey[0];
    if (typeof root === 'string' && (root === 'local-apps' || root.startsWith('integration') || root === 'workspaces'))
      void queryClient.invalidateQueries({ queryKey: ['chat-sources', 'resolve', chatId] }, { cancelRefetch: false });
  }), [queryClient, chatId]);
  return <SourceContext.Provider value={{ chatId, sources: query.data ?? [] }}>{children}</SourceContext.Provider>;
}
export function EditorSourceProvider({ editor, chatId, children }: { editor: Editor | null; chatId?: string; children: ReactNode }) {
  const [refs, setRefs] = useState<string[]>([]);
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const next: string[] = [];
      editor.state.doc.descendants(node => {
        if (node.type.name === 'sourceChip' && typeof node.attrs.sourceRef === 'string') next.push(node.attrs.sourceRef);
      });
      setRefs(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    update(); editor.on('update', update);
    return () => { editor.off('update', update); };
  }, [editor, chatId]);
  return <SourceMetadataProvider chatId={chatId} refs={refs}>{children}</SourceMetadataProvider>;
}
export function SourceChip({ sourceRef, onRemove }: { sourceRef: string; onRemove?: () => void }) {
  const { sources, chatId } = useContext(SourceContext);
  const source = sources.find(item => item.sourceRef === sourceRef);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const label = source?.label ?? 'App reference';
  const status = source?.status ?? 'unavailable';
  const open = async () => {
    if (!chatId) return;
    setBusy(true);
    try {
      await trpcClient.chatSources.openView.mutate({ chatId, sourceRef });
      await queryClient.invalidateQueries({ queryKey: ['local-apps'] });
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not open the app'); }
    finally { setBusy(false); }
  };
  const request = async () => {
    if (!chatId) return;
    setBusy(true);
    try {
      await trpcClient.chatSources.requestAccess.mutate({ chatId, sourceRef });
      toast.info('Review the access card in this chat. Access is granted to the agent, not just this message.');
      await queryClient.invalidateQueries({ queryKey: ['chat-sources'] });
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not request access'); }
    finally { setBusy(false); }
  };
  return <span className="mx-0.5 inline-flex max-w-full items-center rounded-md border border-border bg-muted/60 align-baseline text-[12px]" contentEditable={false}>
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex min-w-0 items-center gap-1 px-1.5 py-0.5" aria-label={`${label}, ${SOURCE_STATUS_LABELS[status]}`}>
          <AppWindow size={12} className="shrink-0" /><span className="max-w-[230px] truncate">@{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3 text-xs" align="start">
        <div><p className="font-medium">{label}</p><p className="mt-1 text-muted-foreground">{SOURCE_STATUS_LABELS[status]}</p></div>
        {source && <div className="flex gap-2 text-muted-foreground">{source.chat && <span className="inline-flex items-center gap-1"><MessageCircle size={12} />Ask Ri</span>}{source.view !== 'none' && <span>{source.view === 'available' ? 'Has a view' : 'View not available here yet'}</span>}</div>}
        {status === 'needs_access' && <p>Access applies to this agent. Selecting a mention does not grant access.</p>}
        <div className="flex flex-wrap gap-2">
          {source?.openPath && chatId && status !== 'unavailable' && <Button size="xs" variant="outline" disabled={busy} onClick={() => void open()}>{source.view === 'available' ? 'Open app' : 'Open app summary'}</Button>}
          {source?.openPath && (!chatId || status === 'unavailable') && <Button size="xs" variant="outline" asChild><a href={source.openPath}>Manage app</a></Button>}
          {source?.managePath && <Button size="xs" variant="outline" asChild><a href={source.managePath}>Manage access</a></Button>}
          {!source?.openPath && (status === 'needs_access' || status === 'reconnect') && <Button size="xs" disabled={busy} onClick={() => void request()}>{status === 'reconnect' ? 'Reconnect' : 'Allow access'}</Button>}
          {!source?.openPath && <Button size="xs" variant="outline" onClick={() => openSettings('plugins', { anchor: 'integrations' })}>Manage accounts</Button>}
          <Button size="xs" variant="ghost" onClick={() => void queryClient.invalidateQueries({ queryKey: ['chat-sources'] })}>Check again</Button>
          {onRemove && <Button size="xs" variant="ghost" onClick={onRemove}>Remove reference</Button>}
        </div>
      </PopoverContent>
    </Popover>
    {onRemove && <Tip label="Keep the app connected and remove this reference"><button type="button" aria-label={`Remove ${label} reference`} className="px-1 py-0.5" onClick={onRemove}><X size={11} /></button></Tip>}
  </span>;
}
export function SourceText({ text, chatId, resolve = true }: { text: string; chatId?: string; resolve?: boolean }) {
  const segments = useMemo(() => parseSourceMarkers(text), [text]);
  const refs = segments.flatMap(s => s.type === 'source' && s.valid ? [s.encoded] : []);
  const content = segments.map((s, i) => s.type === 'text' ? <span key={i}>{s.text}</span> : <SourceChip key={i} sourceRef={s.encoded} />);
  return resolve ? <SourceMetadataProvider chatId={chatId} refs={refs}>{content}</SourceMetadataProvider> : <>{content}</>;
}
