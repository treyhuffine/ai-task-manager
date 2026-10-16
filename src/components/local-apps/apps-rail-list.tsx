'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight, LayoutGrid, Plus, Server } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { IntegrationLogo } from '@/components/integrations/integration-logo';
import { connectedAppsQuery } from '@/components/mcp-apps/catalog';
import { Tip } from '@/components/ui/tip';
import { trpcClient } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { useLocalApps } from './app-hooks';
import { AppMark } from './app-mark';
import { appPlaces, draftRoute, isLibraryRoute, isPlaceRoute, type AppPlace } from './app-places';
import { useAppAction } from './use-app-action';

/**
 * The Apps flyout, the shape of the Agents flyout: a header row with the
 * name and the one action (New app, as the Agents header has New agent),
 * then Open your library and every app you can open by name: installed
 * ones and connections whose MCP server offers an interface, with an amber
 * dot when an action waits on you.
 *
 * The library row is a verb with an arrow, set apart by a rule. As a noun
 * above the apps ("Your library") it read as their heading, not a link.
 */
export function AppsRailList() {
  const { data, enabled } = useLocalApps({ live: false });
  const connected = useQuery(connectedAppsQuery());
  const { activeView, setActiveView } = useDashboard();
  const { busy, run } = useAppAction();
  const route = activeView.kind === 'apps' ? activeView.route : null;
  const apps = appPlaces(data?.instances ?? [], data?.approvals ?? [], connected.data ?? []);

  const newApp = () =>
    void run(async () => {
      const draft = await trpcClient.localApps.createDraft.mutate({ profile: 'react' });
      setActiveView({ kind: 'apps', route: draftRoute(draft.id) });
    });

  return (
    <>
      <div className="flex min-h-[32px] flex-shrink-0 items-center gap-2 border-b border-border/40 px-3">
        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-foreground">Apps</span>
        <div className="flex-1" />
        {enabled && <Tip label="Build an app">
          <button
            type="button"
            onClick={newApp}
            disabled={busy}
            aria-label="Build an app"
            className="rounded bg-primary p-1 text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Plus size={12} />
          </button>
        </Tip>}
      </div>
      <nav aria-label="Apps" className="flex min-h-0 flex-col gap-0.5 overflow-y-auto px-2 py-1.5">
        <Row
          active={route !== null && isLibraryRoute(route)}
          onClick={() => setActiveView({ kind: 'apps', route: '' })}
          icon={<span aria-hidden className="flex size-4 flex-shrink-0 items-center justify-center"><LayoutGrid size={14} /></span>}
          trailing={<ArrowRight size={13} aria-hidden className="flex-shrink-0 opacity-60" />}
        >
          Open your library
        </Row>
        <div aria-hidden className="mx-2 my-1 h-px flex-shrink-0 bg-border/60" />
        {apps.length === 0 ? (
          <p className="px-2 py-3 text-center text-[10.5px] leading-relaxed text-muted-foreground/70">
            Apps you install or connect appear here.
          </p>
        ) : (
          apps.map((app) => (
            <Row
              key={app.key}
              active={route !== null && isPlaceRoute(app, route)}
              onClick={() => setActiveView({ kind: 'apps', route: app.route })}
              icon={<PlaceMark place={app} />}
              trailing={
                app.needsApproval ? (
                  <span className="size-1.5 flex-shrink-0 rounded-full bg-amber-500" aria-label="Needs your approval" />
                ) : undefined
              }
            >
              {app.displayName}
            </Row>
          ))
        )}
      </nav>
    </>
  );
}

/** A row's glyph, as the library draws it: an installed app's tile, the provider's logo, or a server for a custom MCP. */
function PlaceMark({ place }: { place: AppPlace }) {
  const { mark, displayName } = place;
  if (mark.kind === 'app') return <AppMark name={displayName} icon={mark.icon} size="xs" />;
  if (mark.kind === 'provider')
    return (
      <span aria-hidden className="flex shrink-0">
        <IntegrationLogo providerId={mark.providerId} name={displayName} size={16} className="rounded" />
      </span>
    );
  return (
    <span aria-hidden className="inline-flex size-4 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
      <Server size={10} />
    </span>
  );
}

function Row({
  active = false,
  icon,
  trailing,
  children,
  className,
  ...props
}: React.ComponentProps<'button'> & { active?: boolean; icon: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      {...props}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active ? 'bg-muted/60 text-foreground' : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
        className,
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{children}</span>
      {trailing}
    </button>
  );
}
