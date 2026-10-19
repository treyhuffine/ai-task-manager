'use client';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Editor } from '@tiptap/core';
import { MessageCircle, X } from 'lucide-react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tip';
import { openSettings } from '@/components/settings/settings-store';
import { trpcClient } from '@/lib/trpc/client';
import { SOURCE_STATUS_LABELS, type SourceDescriptor } from '@/lib/chat-sources/types';
import { parseSourceMarkers } from '@/lib/chat-sources/reference';
import { useConnectedCompanion } from '@/lib/client/mcp-app-panel';
import { useOptionalDashboard } from '@/contexts/dashboard-context';
import { cn } from '@/lib/utils';
import { SourceMark } from './source-mark';

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
/**
 * Where a chip sits decides its colors. `surface` follows the theme (the composer).
 * `bubble` sits in a sent message, whose bubble inverts the theme (light on a dark
 * page, dark on a light one), so its tint inverts too.
 */
const TONES = {
  surface: {
    live: 'bg-sky-500/10 text-sky-800 ring-sky-500/25 hover:bg-sky-500/15 dark:bg-sky-400/15 dark:text-sky-200 dark:ring-sky-400/30 dark:hover:bg-sky-400/20',
    quiet: 'bg-muted/60 text-muted-foreground ring-border',
  },
  bubble: {
    live: 'bg-sky-400/20 text-sky-200 ring-sky-400/35 hover:bg-sky-400/25 dark:bg-sky-500/12 dark:text-sky-800 dark:ring-sky-500/30 dark:hover:bg-sky-500/20',
    quiet: 'bg-current/10 ring-current/20',
  },
} as const;
export type SourceChipTone = keyof typeof TONES;

export function SourceChip({ sourceRef, onRemove, tone = 'surface' }: { sourceRef: string; onRemove?: () => void; tone?: SourceChipTone }) {
  const companion = useConnectedCompanion();
  const dashboard = useOptionalDashboard();
  const { sources, chatId } = useContext(SourceContext);
  const source = sources.find(item => item.sourceRef === sourceRef);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const label = source?.label ?? 'App reference';
  const chipLabel = source?.chipLabel ?? label;
  const status = source?.status ?? 'unavailable';
  const open = async () => {
    if (!chatId) return;
    setBusy(true);
    try {
      const target = await trpcClient.chatSources.openView.mutate({ chatId, sourceRef });
      if (target.captureId && companion) companion.open(target.captureId);
      else if (target.href) {
        if (dashboard) {
          const url = new URL(target.href, 'https://ri.invalid');
          dashboard.setActiveView({kind: 'apps', route: url.pathname.slice('/apps/'.length), query: Object.fromEntries(url.searchParams)});
        }
        else window.location.assign(target.href);
      }
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
  // Called out like ChatGPT's app mentions: the service's logo and name on a tint.
  // Until it resolves, or once it can't be used here, the chip goes quiet.
  const live = !!source && status !== 'unavailable';
  const attention = status === 'needs_access' || status === 'reconnect';
  return <span data-source-status={source ? status : 'loading'} className={cn(
    'mx-0.5 inline-flex max-w-full items-center rounded-md align-baseline text-[12.5px] font-medium leading-5 ring-1 ring-inset transition-colors',
    live ? TONES[tone].live : TONES[tone].quiet,
  )} contentEditable={false}>
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex min-w-0 items-center gap-1 py-px pr-1.5 pl-1" aria-label={`${label}, ${SOURCE_STATUS_LABELS[status]}`}>
          <SourceMark mark={source?.mark} name={source?.service ?? chipLabel} size={13} />
          <span className="max-w-[230px] truncate">{chipLabel}</span>
          {attention && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-amber-500" />}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3 text-xs" align="start">
        <div className="flex items-start gap-2">
          <SourceMark mark={source?.mark} name={source?.service ?? chipLabel} size={16} className="mt-px" />
          <div className="min-w-0"><p className="font-medium break-words">{source && source.accountLabel?.toLocaleLowerCase() === source.service.toLocaleLowerCase() ? source.service : label}</p><p className="mt-1 text-muted-foreground">{SOURCE_STATUS_LABELS[status]}</p></div>
        </div>
        {source && <div className="flex gap-2 text-muted-foreground">{source.chat && <span className="inline-flex items-center gap-1"><MessageCircle size={12} />Ask Ri</span>}{source.view !== 'none' && <span>{source.view === 'available' ? 'Has a view' : 'View not available here yet'}</span>}</div>}
        {status === 'needs_access' && <p>Access applies to this agent. Selecting a mention does not grant access.</p>}
        <div className="flex flex-wrap gap-2">
          {source?.openPath && chatId && status !== 'unavailable' && <Button size="xs" variant="outline" disabled={busy} onClick={() => void open()}>Open {source.service}</Button>}
          {source?.openPath && (!chatId || status === 'unavailable') && <Button size="xs" variant="outline" asChild><a href={source.openPath}>Manage app</a></Button>}
          {source?.managePath && <Button size="xs" variant="outline" asChild><a href={source.managePath}>Manage access</a></Button>}
          {!source?.openPath && attention && <Button size="xs" disabled={busy} onClick={() => void request()}>{status === 'reconnect' ? 'Reconnect' : 'Allow access'}</Button>}
          {!source?.openPath && <Button size="xs" variant="outline" onClick={() => openSettings('plugins', { anchor: 'integrations' })}>Manage accounts</Button>}
          <Button size="xs" variant="ghost" onClick={() => void queryClient.invalidateQueries({ queryKey: ['chat-sources'] })}>Check again</Button>
          {onRemove && <Button size="xs" variant="ghost" onClick={onRemove}>Remove reference</Button>}
        </div>
      </PopoverContent>
    </Popover>
    {onRemove && <Tip label="Keep the app connected and remove this reference"><button type="button" aria-label={`Remove ${label} reference`} className="-ml-0.5 rounded py-0.5 pr-1 pl-0.5 opacity-70 hover:opacity-100" onClick={onRemove}><X size={11} /></button></Tip>}
  </span>;
}
export function SourceText({ text, chatId, resolve = true, tone }: { text: string; chatId?: string; resolve?: boolean; tone?: SourceChipTone }) {
  const segments = useMemo(() => parseSourceMarkers(text), [text]);
  const refs = segments.flatMap(s => s.type === 'source' && s.valid ? [s.encoded] : []);
  const content = segments.map((s, i) => s.type === 'text' ? <span key={i}>{s.text}</span> : <SourceChip key={i} sourceRef={s.encoded} tone={tone} />);
  return resolve ? <SourceMetadataProvider chatId={chatId} refs={refs}>{content}</SourceMetadataProvider> : <>{content}</>;
}
