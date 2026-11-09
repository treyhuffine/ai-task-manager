'use client';

import { useState } from 'react';
import { Loader2, RefreshCw, Search } from 'lucide-react';
import { useExecutionArtifacts } from '@/hooks/use-execution-artifacts';
import { ArtifactList } from '@/components/chat-ui/artifacts/artifact-list';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tip';
import type { ArtifactListItem } from '@/components/chat-ui/artifacts/artifact-list';
import { PREVIEW_HOST_ATTRIBUTE } from '@/components/chat-ui/artifacts/artifact-preview-store';

export function ArtifactsView({ sessionId, executionId, active, previewHost }: { sessionId: string; executionId: string | null; active: boolean; previewHost: string }) {
  const [query, setQuery] = useState('');
  const artifacts = useExecutionArtifacts(sessionId, executionId, active);
  const unique = new Map<string, ArtifactListItem>();
  for (const page of artifacts.data?.pages ?? []) for (const item of page.items) if (!unique.has(item.key)) unique.set(item.key, item);
  const items = [...unique.values()];
  return <section aria-label="Artifacts" {...{ [PREVIEW_HOST_ATTRIBUTE]: previewHost }} className="flex h-full min-h-0 flex-col">
    <div className="shrink-0 space-y-2 border-b border-border p-3">
      <div className="flex items-center justify-between gap-2"><p className="text-xs text-muted-foreground">Files from every chat</p>
        <Tip label="Check for shared files"><Button variant="ghost" size="icon-sm" aria-label="Refresh artifacts" disabled={artifacts.isFetching} onClick={() => void artifacts.refetch()}><RefreshCw className={artifacts.isFetching ? 'animate-spin' : undefined} /></Button></Tip>
      </div>
      <label className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-2.5 py-2"><Search size={13} aria-hidden className="shrink-0 text-muted-foreground" /><input aria-label="Filter artifacts" value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter by filename, path or chat" className="min-w-0 w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/70" /></label>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
      {artifacts.isPending ? <div role="status" className="flex items-center justify-center gap-2 p-8 text-xs text-muted-foreground"><Loader2 size={14} className="animate-spin" />Loading artifacts…</div>
        : <>
          {artifacts.error && <div role="status" className="p-4 text-sm text-muted-foreground"><p>Couldn&apos;t load artifacts. {artifacts.error.message}</p><Button variant="ghost" size="sm" onClick={() => void artifacts.refetch()}>Try again</Button></div>}
          {(!artifacts.error || items.length > 0) && <ArtifactList items={items} query={query} />}
          {artifacts.hasNextPage && <div className="space-y-1 p-3 text-center"><p className="text-[11px] text-muted-foreground">{query ? 'The filter applies to loaded files. Load older messages to find more.' : 'More files may be in older messages.'}</p><Button variant="ghost" size="sm" disabled={artifacts.isFetching} onClick={() => void artifacts.fetchNextPage()}>{artifacts.isFetchingNextPage ? 'Loading…' : 'Load older messages'}</Button></div>}
        </>}
    </div>
  </section>;
}
