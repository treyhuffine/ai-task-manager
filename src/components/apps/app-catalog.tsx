'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowUpCircle, Library, Loader2 } from 'lucide-react';
import { uuidv7 } from 'uuidv7';
import { Button } from '@/components/ui/button';
import { trpc, trpcClient } from '@/lib/trpc/client';
import { ensureAppBuilderChat } from './new-app-dialog';

/**
 * Update an app added from the catalog (docs/personal-apps.md "The catalog"). When the person
 * changed the app, Ri opens a change and this asks the builder to merge the update there first.
 */
export function useCatalogUpdate(sourceId: string | null, onDone?: (mode: 'current' | 'switch' | 'merge') => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const update = await trpcClient.appBuilds.updateFromCatalog.mutate({ id: sourceId! });
      if (update.mode === 'merge') {
        const chat = await ensureAppBuilderChat(sourceId!);
        await trpcClient.sessions.messagesPost.mutate({ params: { id: chat.id }, body: { id: uuidv7(), content: update.message } });
      }
      return update.mode;
    },
    onSuccess: (mode) => onDone?.(mode),
    onSettled: () => queryClient.invalidateQueries({ queryKey: trpc.appBuilds.pathKey() }),
  });
}

/** One catalog app's update, where the app has one. */
export function useCatalogApp(sourceId: string | null | undefined) {
  const catalog = useQuery({ ...trpc.appBuilds.catalog.queryOptions(undefined, { staleTime: 60_000 }), enabled: !!sourceId });
  return catalog.data?.apps.find((app) => app.sourceId === sourceId) ?? null;
}

/**
 * Ri's recommended apps (docs/personal-apps.md "The catalog"): each one's own repository at a pinned
 * version. Add puts the app in the apps folder as the person's own repository, then installs and
 * connects it. An added app shows an update when the catalog has a newer version.
 */
export function AppCatalogList({ onOpen }: { onOpen: (sourceId: string) => void }) {
  const catalog = useQuery(trpc.appBuilds.catalog.queryOptions(undefined, { staleTime: 60_000 }));
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: (id: string) => { setAdding(id); return trpcClient.appBuilds.addFromCatalog.mutate({ id, returnTo: `${window.location.pathname}${window.location.search}` }); },
    onSuccess: ({ source }) => { setError(null); void queryClient.invalidateQueries({ queryKey: trpc.appBuilds.pathKey() }); onOpen(source.id); },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
    onSettled: () => setAdding(null),
  });
  const data = catalog.data;
  if (!data || (!data.apps.length && !data.error)) return null;

  return (
    <section aria-labelledby="app-catalog" className="space-y-2">
      <h3 id="app-catalog" className="flex items-center gap-1.5 text-xs font-semibold"><Library size={13} aria-hidden />Recommended apps</h3>
      {(error || data.error) && <p role="alert" className="flex items-start gap-2 text-xs text-destructive"><AlertCircle size={13} className="mt-0.5 shrink-0" />{error ?? data.error}</p>}
      <ul className="divide-y divide-border rounded-lg border border-border">
        {data.apps.map((app) => (
          <li key={app.id} className="flex items-start gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-sm">{app.name} <span className="text-[11px] text-muted-foreground">{app.installedVersion ?? app.version}</span></p>
              <p className="text-xs text-muted-foreground">{app.description}</p>
              <p className="text-[11px] text-muted-foreground">{app.reaches.length ? `Can reach: ${app.reaches.join(', ')}.` : 'Keeps to its own data.'}</p>
            </div>
            {!app.sourceId ? (
              <Button size="xs" disabled={add.isPending} onClick={() => add.mutate(app.id)}>
                {adding === app.id && <Loader2 size={12} className="animate-spin" />}Add
              </Button>
            ) : app.updateAvailable ? (
              <Button size="xs" variant="outline" onClick={() => onOpen(app.sourceId!)}><ArrowUpCircle size={12} aria-hidden />Update to {app.version}</Button>
            ) : (
              <span className="self-center text-[11px] text-muted-foreground">Added</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
