'use client';

import { LayoutGrid, Plus } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { Tip } from '@/components/ui/tip';
import { trpcClient } from '@/lib/trpc/client';
import { cn } from '@/lib/utils';
import { useLocalApps } from './app-hooks';
import { AppMark } from './app-mark';
import { appPlaces, draftRoute, isAppRoute, isLibraryRoute } from './app-places';
import { useAppAction } from './use-app-action';

/**
 * The Apps flyout, the shape of the Agents flyout: a header row with the
 * name and the one action (New app, as the Agents header has New agent),
 * then All apps (the library) and each installed app by name, with an amber
 * dot when an action waits on you.
 */
export function AppsRailList() {
  const { data } = useLocalApps({ live: false });
  const { activeView, setActiveView } = useDashboard();
  const { busy, run } = useAppAction();
  const route = activeView.kind === 'apps' ? activeView.route : null;
  const apps = appPlaces(data?.instances ?? [], data?.approvals ?? []);

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
        <Tip label="New app">
          <button
            type="button"
            onClick={newApp}
            disabled={busy}
            aria-label="New app"
            className="rounded bg-primary p-1 text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Plus size={12} />
          </button>
        </Tip>
      </div>
      <nav aria-label="Apps" className="flex min-h-0 flex-col gap-0.5 overflow-y-auto px-2 py-1.5">
        <Row
          active={route !== null && isLibraryRoute(route)}
          onClick={() => setActiveView({ kind: 'apps', route: '' })}
          icon={<LayoutGrid size={14} className="flex-shrink-0" />}
        >
          All apps
        </Row>
        {apps.length === 0 ? (
          <p className="px-2 py-3 text-center text-[10.5px] leading-relaxed text-muted-foreground/70">
            No apps yet. Build one, or add an included app from All apps.
          </p>
        ) : (
          apps.map((app) => (
            <Row
              key={app.id}
              active={route !== null && isAppRoute(route, app.slug)}
              onClick={() => setActiveView({ kind: 'apps', route: app.slug })}
              icon={<AppMark name={app.displayName} size="xs" />}
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
