'use client';
import { Command } from 'cmdk';
import { EntityIcon } from './search-palette';
import type { RecentItem } from '@/lib/api/recents';

export function RecentSearchItems({ items, onSelect }: { items: RecentItem[]; onSelect: (type: string, id: string) => void }) {
  if (!items.length) return null;
  return <Command.Group heading="Recent" className="px-2 pb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[9px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-muted-foreground/60">
    {items.map(item => <Command.Item key={`recent-${item.entityType}-${item.id}`} value={`recent-${item.entityType}-${item.id}`} onSelect={() => onSelect(item.entityType, item.id)} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left data-[selected=true]:bg-muted/50"><EntityIcon type={item.entityType} hasBody={item.hasBody} className="shrink-0 text-primary/60"/><span className="line-clamp-1 flex-1 text-[12px] font-medium">{item.title || '(untitled)'}</span><span className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground/60">{item.entityType}</span></Command.Item>)}
  </Command.Group>;
}
