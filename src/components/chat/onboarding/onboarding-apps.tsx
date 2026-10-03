'use client';

import { ConnectorLogo } from '@/components/connectors/connector-logo';
import { connectorMeta } from '@/components/connectors/connector-meta';
import type { Connection, ProviderStatus } from '@/components/settings/sections/connectors/types';
import { openSettings, useSettingsStore } from '@/components/settings/settings-store';
import { trpcClient } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, Loader2, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { listJoin } from './onboarding-flow';

/**
 * The apps most people want first, in this order. Only ones the connector
 * engine offers are shown, and search reaches every other one.
 */
export const POPULAR_APPS = ['google', 'slack', 'notion', 'linear', 'github', 'microsoft', 'granola', 'todoist', 'asana', 'hubspot'];

/** How many search results to show before pointing at the full catalog. */
const SEARCH_LIMIT = 8;

interface Catalog {
  providers: ProviderStatus[];
  connections: Connection[];
}

/**
 * The connectors step: a row of popular apps and a search over all of them.
 * Picking one opens its page in Settings, Plugins, where every way of
 * connecting already lives (signing in, a key, an app of your own), rather
 * than a second copy of that here. Coming back (closing Settings, or
 * returning from a sign-in page) refreshes what's connected.
 */
export function OnboardingApps({ onDone }: { onDone: (summary: string) => void }) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['connectors', 'onboarding-catalog'],
    queryFn: async (): Promise<Catalog> => {
      const [status, connections] = await Promise.all([
        trpcClient.connectors.statusGet.query({}),
        trpcClient.connectors.connectionsGet.query({}),
      ]);
      return { providers: status.providers, connections: connections.connections };
    },
    refetchOnWindowFocus: true,
  });

  // Settings is where the connecting happens, so its closing is the moment
  // something may have changed.
  const { open: settingsOpen } = useSettingsStore();
  const wasOpen = useRef(settingsOpen);
  useEffect(() => {
    if (wasOpen.current && !settingsOpen) void refetch();
    wasOpen.current = settingsOpen;
  }, [settingsOpen, refetch]);

  const [query, setQuery] = useState('');
  const connected = useMemo(() => new Set((data?.connections ?? []).map((c) => c.providerId)), [data?.connections]);
  const byId = useMemo(() => new Map((data?.providers ?? []).map((p) => [p.id, p])), [data?.providers]);
  const popular = POPULAR_APPS.map((id) => byId.get(id)).filter((p): p is ProviderStatus => !!p);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return [];
    return (data?.providers ?? []).filter((p) => {
      const meta = connectorMeta(p.id);
      return (
        p.displayName.toLowerCase().includes(q) ||
        p.id.includes(q) ||
        meta.description.toLowerCase().includes(q) ||
        meta.category.toLowerCase().includes(q)
      );
    });
  }, [data?.providers, q]);

  const open = (p: ProviderStatus) => openSettings('plugins', { anchor: `connectors:${p.id}` });
  const connectedNames = (data?.providers ?? []).filter((p) => connected.has(p.id)).map((p) => p.displayName);

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3 shadow-sm">
      {isLoading ? (
        <div className="flex items-center gap-2 px-1 py-6 text-[11px] text-muted-foreground">
          <Loader2 size={12} className="animate-spin" /> Loading apps…
        </div>
      ) : (
        <>
          <div
            className="-mx-1 flex snap-x gap-1.5 overflow-x-auto px-1 pb-1.5 [scrollbar-width:thin]"
            style={{ maskImage: 'linear-gradient(to right, black calc(100% - 24px), transparent)' }}
          >
            {popular.map((p) => (
              <AppTile key={p.id} provider={p} connected={connected.has(p.id)} onOpen={() => open(p)} />
            ))}
          </div>

          <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-background px-2.5">
            <Search size={12} className="flex-shrink-0 text-muted-foreground/60" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={data ? `Search all ${data.providers.length} apps` : 'Search apps'}
              aria-label="Search apps"
              className="h-8 min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/50"
            />
          </div>

          {q && (
            <div className="mt-1.5 flex flex-col">
              {results.length === 0 ? (
                <p className="px-1 py-2 text-[11px] text-muted-foreground">
                  Nothing by that name.{' '}
                  <button
                    type="button"
                    onClick={() => openSettings('plugins', { anchor: 'connectors' })}
                    className="underline-offset-2 hover:underline"
                  >
                    Add your own in Settings
                  </button>
                  , any MCP server works.
                </p>
              ) : (
                results.slice(0, SEARCH_LIMIT).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => open(p)}
                    className="flex items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-muted/50"
                  >
                    <ConnectorLogo providerId={p.id} name={p.displayName} size={26} />
                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="truncate text-[12px] font-medium text-foreground">{p.displayName}</span>
                      <span className="truncate text-[10.5px] text-muted-foreground">{connectorMeta(p.id).description}</span>
                    </span>
                    <ConnectState connected={connected.has(p.id)} />
                  </button>
                ))
              )}
              {results.length > SEARCH_LIMIT && (
                <button
                  type="button"
                  onClick={() => openSettings('plugins', { anchor: 'connectors' })}
                  className="self-start px-1.5 py-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                >
                  {results.length - SEARCH_LIMIT} more in Settings
                </button>
              )}
            </div>
          )}
        </>
      )}

      <div className="mt-3 flex items-center justify-end gap-1.5">
        {connectedNames.length === 0 ? (
          <button
            type="button"
            onClick={() => onDone('Not now')}
            className="rounded-md px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            Not now
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onDone(`Connected ${listJoin(connectedNames)}`)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Continue <ArrowRight size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

function AppTile({ provider, connected, onOpen }: { provider: ProviderStatus; connected: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={connectorMeta(provider.id).description}
      className={cn(
        'flex w-[7.5rem] flex-shrink-0 snap-start flex-col items-start gap-2 rounded-lg border p-2 text-left transition-colors',
        connected ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border hover:bg-muted/50',
      )}
    >
      <ConnectorLogo providerId={provider.id} name={provider.displayName} size={30} />
      <span className="flex w-full flex-col leading-tight">
        <span className="truncate text-[12px] font-medium text-foreground">{provider.displayName}</span>
        <ConnectState connected={connected} />
      </span>
    </button>
  );
}

function ConnectState({ connected }: { connected: boolean }) {
  return connected ? (
    <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-emerald-600 dark:text-emerald-400">
      <Check size={10} /> Connected
    </span>
  ) : (
    <span className="text-[10.5px] text-muted-foreground">Connect</span>
  );
}
