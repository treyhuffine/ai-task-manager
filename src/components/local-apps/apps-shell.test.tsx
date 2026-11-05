/**
 * The route and query an app opens at come from the same place. The URL's search
 * params catch up a render after a location change. If the new route met the old
 * query, the app view would read it as a different location and reopen, losing
 * what it holds, such as a key shown once.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeView: { kind: 'apps', route: 'bookmarks/connect' } as { kind: string; route?: string; query?: Record<string, string> },
  opened: [] as { path: string; query: Record<string, string> }[],
}));

// The address still shows the old search, as it does for a render after a location change.
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('q=tide') }));
vi.mock('@/contexts/dashboard-context', () => ({ useDashboard: () => ({ activeView: mocks.activeView, setActiveView: () => {}, goHome: () => {} }) }));
vi.mock('./app-hooks', () => ({ useLocalApps: () => ({ data: { instances: [{ id: 'a', slug: 'bookmarks' }], drafts: [] }, enabled: true, error: null, checking: false }) }));
vi.mock('./app-builder', () => ({ AppBuilder: () => null }));
vi.mock('./layout-review', () => ({ AppsLibraryScreen: () => null }));
vi.mock('@/components/mcp-apps/page', () => ({ ConnectedAppPage: () => null }));
vi.mock('./app-page', () => ({ AppPage: (props: { path: string; query: Record<string, string> }) => { mocks.opened.push({ path: props.path, query: props.query }); return null; } }));

beforeEach(() => { mocks.opened.length = 0; });

it('opens the new route without the query the address has not dropped yet', async () => {
  const { AppsShell } = await import('./apps-shell');
  renderToStaticMarkup(<AppsShell route="bookmarks/connect" />);
  expect(mocks.opened).toEqual([{ path: '/connect', query: {} }]);
});

it('passes the query the route was opened with', async () => {
  mocks.activeView = { kind: 'apps', route: 'bookmarks', query: { q: 'tide' } };
  const { AppsShell } = await import('./apps-shell');
  renderToStaticMarkup(<AppsShell route="bookmarks" />);
  expect(mocks.opened).toEqual([{ path: '/', query: { q: 'tide' } }]);
});
