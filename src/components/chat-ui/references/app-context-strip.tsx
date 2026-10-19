'use client';
import { useState } from 'react';
import { AppWindow, ExternalLink, FileText, Loader2, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tip } from '@/components/ui/tip';
import type { VisibleContextItem } from '@/lib/client/mcp-app-context';
import { cn } from '@/lib/utils';

/** One app's attached context, as the composer shows it. */
export interface AppContextGroupView {
  viewId: string;
  app: string;
  items: VisibleContextItem[];
}

/** The chip's short summary: the titled items first, then how many more. */
export function contextSummary(items: readonly VisibleContextItem[]): string {
  const named = items.flatMap(item => item.kind === 'image' ? (item.title ? [item.title] : []) : item.kind === 'text' ? (item.title ? [item.title] : []) : [item.title]);
  if (!named.length) return items.length === 1 ? '1 item' : `${items.length} items`;
  const rest = items.length - 1;
  return rest > 0 ? `${named[0]} and ${rest} more` : named[0]!;
}

/**
 * What connected apps attached to the next message, above the composer
 * (OpenAI's model context, docs/connected-mcp-apps.md "Model context"). One
 * chip per app, its items in one popover, removed together, as ChatGPT
 * desktop groups them. Items an app gave the assistant alone never show.
 */
export function AppContextStrip({ groups, onRemove }: { groups: readonly AppContextGroupView[]; onRemove: (viewId: string) => Promise<void> | void }) {
  if (!groups.length) return null;
  return <div className="flex flex-wrap gap-1 px-2.5 pt-2" aria-label="Context from apps">
    {groups.map(group => <AppContextChip key={group.viewId} group={group} onRemove={() => onRemove(group.viewId)} />)}
  </div>;
}

function AppContextChip({ group, onRemove }: { group: AppContextGroupView; onRemove: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try { await onRemove(); } finally { setBusy(false); }
  };
  return <span className="inline-flex max-w-full items-center rounded-md bg-muted/60 text-[11.5px] text-foreground ring-1 ring-inset ring-border">
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex min-w-0 items-center gap-1 py-0.5 pl-1.5 pr-1" aria-label={`Context from ${group.app}`}>
          <AppWindow size={12} className="shrink-0 text-muted-foreground" aria-hidden />
          <span className="shrink-0 font-medium">{group.app}</span>
          <span className="min-w-0 max-w-[220px] truncate text-muted-foreground">{contextSummary(group.items)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2 p-3 text-xs" align="start">
        <p className="font-medium">{group.app} adds this to your next message</p>
        <ul className="max-h-72 space-y-2 overflow-y-auto">
          {group.items.map((item, index) => <li key={index}><ContextItem item={item} /></li>)}
        </ul>
        <p className="text-muted-foreground">It goes with each message you send until you remove it.</p>
      </PopoverContent>
    </Popover>
    <Tip label="Nothing from it is sent, and the app is told">
      <button type="button" disabled={busy} onClick={() => void remove()} aria-label={`Remove context from ${group.app}`}
        className="mr-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground/80 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50">
        {busy ? <Loader2 size={10} className="animate-spin" /> : <X size={10} />}
      </button>
    </Tip>
  </span>;
}

function ContextItem({ item }: { item: VisibleContextItem }) {
  if (item.kind === 'image') return <figure className="space-y-1">
    {/* eslint-disable-next-line @next/next/no-img-element -- a data URL the app attached, not a page asset */}
    <img src={item.src} alt={item.title ?? 'Image from the app'} className="max-h-40 rounded border border-border object-contain" />
    {item.title && <figcaption className="text-muted-foreground">{item.title}</figcaption>}
  </figure>;
  if (item.kind === 'link') return <div className="flex min-w-0 items-start gap-1.5">
    <ExternalLink size={12} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
    <div className="min-w-0"><p className="font-medium [overflow-wrap:anywhere]">{item.title}</p><p className="text-muted-foreground [overflow-wrap:anywhere]">{item.uri}</p></div>
  </div>;
  if (item.kind === 'resource') return <div className="flex min-w-0 items-start gap-1.5">
    <FileText size={12} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
    <div className="min-w-0"><p className="font-medium [overflow-wrap:anywhere]">{item.title}</p>{item.text && <p className="line-clamp-4 whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{item.text}</p>}</div>
  </div>;
  return <div className="flex min-w-0 items-start gap-2">
    {item.thumbnail && (
      // eslint-disable-next-line @next/next/no-img-element -- the app's thumbnail, an https or data URL
      <img src={item.thumbnail.src} alt="" className="size-10 shrink-0 rounded border border-border object-cover" />
    )}
    <div className="min-w-0">
      {item.title && <p className="font-medium [overflow-wrap:anywhere]">{item.title}</p>}
      <p className={cn('whitespace-pre-wrap [overflow-wrap:anywhere]', item.title ? 'line-clamp-3 text-muted-foreground' : 'line-clamp-4')}>{item.text}</p>
    </div>
  </div>;
}
