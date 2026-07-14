'use client';

import { useDeferredValue, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useSessionSearch } from '@/hooks/use-session-search';
import type { SessionSearchFilters } from '@/lib/api/sessions';
import { cn } from '@/lib/utils';
import { HistoryRow } from './history-row';

type StatusFacet = 'all' | 'active' | 'archived';
type SourceFacet = 'all' | 'native' | 'imported';

/**
 * Transcript search results for the rail. Rendered in place of the active tab
 * whenever the persistent rail search box has a query. Results are ranked by
 * relevance (BM25) — a flat list, not date-bucketed, so the strongest match is
 * always first; each row carries its own date stamp and a highlighted snippet.
 *
 * Facets (status, source) are local to this view — the query itself lives in
 * the rail so it survives tab switches.
 */
export function SessionSearchResults({ query }: { query: string }) {
  const [status, setStatus] = useState<StatusFacet>('all');
  const [source, setSource] = useState<SourceFacet>('all');

  // Defer so we fire one request per settle, not per keystroke.
  const deferredQuery = useDeferredValue(query);
  const filters: SessionSearchFilters = {
    status: status === 'all' ? undefined : status,
    source: source === 'all' ? undefined : source,
  };
  const { data, isLoading, isFetching } = useSessionSearch(deferredQuery, filters);

  const results = data ?? [];
  const trimmed = deferredQuery.trim();

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-1.5 px-2 pt-1.5 pb-2 border-b border-border/40">
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'archived', label: 'Archived' },
          ]}
        />
        <Segmented
          value={source}
          onChange={setSource}
          options={[
            { value: 'all', label: 'All' },
            { value: 'native', label: 'Native' },
            { value: 'imported', label: 'Imported' },
          ]}
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 px-3 py-6 text-[10px] text-muted-foreground/70">
          <Loader2 size={12} className="animate-spin" />
          Searching transcripts…
        </div>
      ) : results.length === 0 ? (
        <div className="px-3 py-6 text-center text-[10px] text-muted-foreground/70 leading-relaxed">
          No chats match {'“'}
          {trimmed}
          {'”'}.
        </div>
      ) : (
        <div className="flex flex-col px-1 pt-1">
          <div className="flex items-center gap-1.5 px-2 pb-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
            <span>
              {results.length} match{results.length === 1 ? '' : 'es'}
            </span>
            {isFetching && <Loader2 size={9} className="animate-spin opacity-60" />}
          </div>
          {results.map((r) => (
            <HistoryRow key={r.id} session={r} snippet={r.snippet} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Segmented facet control ──────────────────────────────────

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-md bg-muted/40 p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            'flex-1 rounded px-1.5 py-0.5 text-[9.5px] font-medium transition-colors',
            value === opt.value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground/70 hover:text-foreground',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
