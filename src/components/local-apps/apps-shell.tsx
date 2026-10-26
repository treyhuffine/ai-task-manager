'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { viewFromSearchParams } from '@/lib/client/active-view';
import { AppBuilder } from './app-builder';
import { useLocalApps } from './app-hooks';
import { AppsLayoutReview } from './layout-review';
import { AppPage } from './app-page';
import { ConnectedAppPage } from '@/components/mcp-apps/page';

export { useLocalApps } from './app-hooks';

/**
 * What `/apps/<route>` shows: the library, a draft in the builder, or an
 * installed app at a path inside it. The URL owns the route and the app's
 * own query, so Back, refresh and links land where they point.
 */
export function AppsShell({ route }: { route: string }) {
  const { data, enabled, error, checking } = useLocalApps();
  const { setActiveView, goHome } = useDashboard();
  const searchParams = useSearchParams();
  const currentView = viewFromSearchParams(searchParams, `/apps/${route}`);
  const appQuery = currentView.kind === 'apps' ? (currentView.query ?? {}) : {};

  const navigate = useCallback((value: string, options?: { replace?: boolean }) => {
    const location = new URL(value, 'https://app.invalid/');
    setActiveView({ kind: 'apps', route: location.pathname.slice(1), query: Object.fromEntries(location.searchParams) }, options);
  }, [setActiveView]);

  const parts = route.split('/').filter(Boolean);
  // One page per connection, so a deep link to a screen that is open reaches its live view instead of a new one.
  if (parts[0] === '~connected' && parts[1]) return <ConnectedAppPage key={parts[1]} serverId={parts[1]} navigate={navigate} resultId={appQuery.result} screenId={appQuery.screen} launch={appQuery.open} deepLink={appQuery.path}/>;
  // The library includes connections and skills even when local execution is off.
  if (parts.length === 0 || parts[0] === 'new') return <AppsLayoutReview data={data} localEnabled={enabled}
    localLoading={checking || (enabled && !data && !error)} localError={error} query={appQuery} navigate={navigate} />;

  const frame = (children: React.ReactNode) => (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">{children}</div>
  );
  const notice = (title: string, detail: string, action?: { label: string; onClick: () => void }) =>
    frame(
      <div className="flex flex-1 items-center justify-center px-8 text-center">
        <div>
          <p className="text-[13px] font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-[11px] text-muted-foreground/80">{detail}</p>
          <div className="mt-3 flex justify-center gap-1">
            {action && (
              <button
                type="button"
                onClick={action.onClick}
                className="inline-flex items-center rounded-md px-3 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/10"
              >
                {action.label}
              </button>
            )}
            <button
              type="button"
              onClick={goHome}
              className="inline-flex items-center rounded-md px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted"
            >
              Back to Home
            </button>
          </div>
        </div>
      </div>,
    );

  if (error) return notice('Apps couldn’t load.', error.message);
  if (!checking && !enabled) {
    return notice(
      'Apps are disabled for this Home.',
      'Remove the RI_LOCAL_APPS override and restart the Home to enable Apps.',
    );
  }
  if (!data) {
    return frame(
      <div className="flex flex-1 items-center justify-center">
        <Loader2 size={16} className="animate-spin text-muted-foreground" />
      </div>,
    );
  }

  if (parts[0] === 'drafts') {
    const draft = data.drafts.find((item) => item.id === parts[1]);
    if (!draft) {
      return notice('This draft isn’t here anymore.', 'It may have been used, or the link is wrong.', {
        label: 'Open Apps',
        onClick: () => navigate(''),
      });
    }
    return <AppBuilder key={draft.id} draft={draft} data={data} navigate={navigate} />;
  }

  const instance = data.instances.find((item) => item.slug === parts[0]);
  if (!instance) {
    return notice('This app isn’t here anymore.', 'It may have been renamed or removed, or the link is wrong.', {
      label: 'Open Apps',
      onClick: () => navigate(''),
    });
  }
  return (
    <AppPage
      key={instance.id}
      instance={instance}
      data={data}
      path={`/${parts.slice(1).join('/')}`}
      query={appQuery}
      navigate={navigate}
    />
  );
}
