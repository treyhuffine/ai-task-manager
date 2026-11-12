'use client';

import { useCallback } from 'react';
import { useDashboard } from '@/contexts/dashboard-context';
import { AppsLibraryScreen } from './layout-review';
import { ConnectedAppPage } from '@/components/mcp-apps/page';

/**
 * What `/apps/<route>` shows: the library, or a connected app's page. The URL
 * owns the route and the app's own query, so Back, refresh and links land
 * where they point. Any other route is a link to something that is gone.
 */
export function AppsShell({ route }: { route: string }) {
  const { activeView, setActiveView, goHome } = useDashboard();
  // The route and its query come from the same place. The URL's search params
  // catch up a render later, and a new route paired with the old query looks
  // like a different location, which reopens the app and loses what it holds.
  const appQuery = activeView.kind === 'apps' ? (activeView.query ?? {}) : {};

  const navigate = useCallback((value: string, options?: { replace?: boolean }) => {
    const location = new URL(value, 'https://app.invalid/');
    // An app's own root is `/`, which would otherwise leave a trailing slash on its address.
    setActiveView({ kind: 'apps', route: location.pathname.replace(/\/+$/, '').slice(1), query: Object.fromEntries(location.searchParams) }, options);
  }, [setActiveView]);

  const parts = route.split('/').filter(Boolean);
  // One page per connection, so a deep link to a screen that is open reaches its live view instead of a new one.
  if (parts[0] === '~connected' && parts[1]) return <ConnectedAppPage key={parts[1]} serverId={parts[1]} navigate={navigate} resultId={appQuery.result} screenId={appQuery.screen} launch={appQuery.open} deepLink={appQuery.path}/>;
  if (parts.length === 0 || parts[0] === 'new') return <AppsLibraryScreen query={appQuery} navigate={navigate} />;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div className="flex flex-1 items-center justify-center px-8 text-center">
        <div>
          <p className="text-[13px] font-semibold text-foreground">This app isn’t here anymore.</p>
          <p className="mt-1 text-[11px] text-muted-foreground/80">It may have been renamed or removed, or the link is wrong.</p>
          <div className="mt-3 flex justify-center gap-1">
            <button
              type="button"
              onClick={() => navigate('')}
              className="inline-flex items-center rounded-md px-3 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/10"
            >
              Open Apps
            </button>
            <button
              type="button"
              onClick={goHome}
              className="inline-flex items-center rounded-md px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted"
            >
              Back to Home
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
