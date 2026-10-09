'use client';

import { useEffect, useState } from 'react';
import { CheckSquare, FileText, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/lib/trpc/client';
import { rpcQuery } from '@/lib/trpc/request-options';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useTeamNav } from './team-context';

/**
 * Search the team's shared tasks and notes (docs/homes-spec.md §3.2, §9.2):
 * keyword search, scoped to this team, with no AI.
 */
export function TeamSearch() {
  const nav = useTeamNav();
  const open = nav.panel === 'search';
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 150);
    return () => clearTimeout(timer);
  }, [query]);
  const results = useQuery({
    queryKey: ['team-search', debounced],
    queryFn: () => trpcClient.search.list.query({ query: rpcQuery({ q: debounced, mode: 'keyword', limit: '30' }) }),
    enabled: open && debounced.length > 0,
    staleTime: 10_000,
  });
  const hits = (results.data ?? []).filter((hit) => hit.entityType === 'task' || hit.entityType === 'note');

  const go = (hit: (typeof hits)[number]) => {
    if (hit.entityType === 'task') nav.openTask(hit.id);
    else nav.openNote(hit.id);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        setQuery('');
        nav.openPanel(null);
      }}
    >
      <DialogContent className="top-[20%] max-w-lg translate-y-0 gap-0 p-0" showCloseButton={false}>
        <DialogTitle className="sr-only">Search the team</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search size={15} className="text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hits[0]) go(hits[0]);
            }}
            placeholder="Search tasks and notes"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {debounced && results.isSuccess && hits.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing matches.</li>}
          {hits.map((hit) => (
            <li key={`${hit.entityType}:${hit.id}`}>
              <button type="button" onClick={() => go(hit)} className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm hover:bg-muted/50">
                {hit.entityType === 'task' ? <CheckSquare size={14} className="text-muted-foreground" /> : <FileText size={14} className="text-muted-foreground" />}
                <span className="truncate">{(hit as { title?: string | null }).title?.trim() || 'Untitled'}</span>
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
