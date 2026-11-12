'use client';

import { useQuery } from '@tanstack/react-query';
import { GitBranch, Hammer, Loader2 } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';

/**
 * Apps being built or changed (docs/personal-apps.md "Building and changing apps"): ones not
 * installed yet, and installed ones with a change open. Each opens its builder chat and steps.
 */
export function AppBuildsList({ onOpen }: { onOpen: (sourceId: string) => void }) {
  const builds = useQuery(trpc.appBuilds.list.queryOptions(undefined, { staleTime: 10_000 }));
  const open = (builds.data ?? []).filter((source) => source.createdByRi && (!source.url || source.changeFolder));
  if (!open.length) return null;
  return (
    <section aria-labelledby="app-builds" className="space-y-2">
      <h3 id="app-builds" className="flex items-center gap-1.5 text-xs font-semibold"><Hammer size={13} aria-hidden />Apps you&apos;re building</h3>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {open.map((source) => (
          <li key={source.id}>
            <button type="button" onClick={() => onOpen(source.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/40">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{source.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {source.changeFolder ? <><GitBranch size={10} className="mr-1 inline" aria-hidden />A change in progress</> : 'Not installed yet'}
                </span>
              </span>
              {source.job?.state === 'running' && <Loader2 size={13} className="animate-spin text-muted-foreground" aria-label="Running" />}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
