/**
 * The route and query an app opens at come from the same place. The URL's search
 * params catch up a render after a location change. If the new route met the old
 * query, the app's page would read it as a different location and reopen, losing
 * what it holds, such as a screen that is open.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeView: { kind: 'apps', route: '~connected/canvas' } as { kind: string; route?: string; query?: Record<string, string> },
  opened: [] as { serverId: string; launch?: string; screenId?: string }[],
  library: [] as Record<string, string>[],
  builds: [] as string[],
}));

// The address still shows the old search, as it does for a render after a location change.
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('open=gallery') }));
vi.mock('@/contexts/dashboard-context', () => ({ useDashboard: () => ({ activeView: mocks.activeView, setActiveView: () => {}, goHome: () => {} }) }));
vi.mock('./app-build-page', () => ({ AppBuildPage: (props: { sourceId: string }) => { mocks.builds.push(props.sourceId); return null; } }));
vi.mock('./layout-review', () => ({ AppsLibraryScreen: (props: { query: Record<string, string> }) => { mocks.library.push(props.query); return null; } }));
vi.mock('@/components/mcp-apps/page', () => ({
  ConnectedAppPage: (props: { serverId: string; launch?: string; screenId?: string }) => {
    mocks.opened.push({ serverId: props.serverId, launch: props.launch, screenId: props.screenId });
    return null;
  },
}));

beforeEach(() => { mocks.opened.length = 0; mocks.library.length = 0; });

it('opens the new route without the query the address has not dropped yet', async () => {
  mocks.activeView = { kind: 'apps', route: '~connected/canvas' };
  const { AppsShell } = await import('./apps-shell');
  renderToStaticMarkup(<AppsShell route="~connected/canvas" />);
  expect(mocks.opened).toEqual([{ serverId: 'canvas', launch: undefined, screenId: undefined }]);
});

it('passes the query the route was opened with', async () => {
  mocks.activeView = { kind: 'apps', route: '~connected/canvas', query: { open: 'home' } };
  const { AppsShell } = await import('./apps-shell');
  renderToStaticMarkup(<AppsShell route="~connected/canvas" />);
  expect(mocks.opened).toEqual([{ serverId: 'canvas', launch: 'home', screenId: undefined }]);
});

it('shows the library at its own route, with its query', async () => {
  mocks.activeView = { kind: 'apps', route: '', query: { q: 'tide' } };
  const { AppsShell } = await import('./apps-shell');
  renderToStaticMarkup(<AppsShell route="" />);
  expect(mocks.library).toEqual([{ q: 'tide' }]);
});

it('says an app at any other route is gone, without opening anything', async () => {
  mocks.activeView = { kind: 'apps', route: 'finances/views/1' };
  const { AppsShell } = await import('./apps-shell');
  const html = renderToStaticMarkup(<AppsShell route="finances/views/1" />);
  expect(html).toContain('This app isn’t here anymore.');
  expect(html).toContain('Open Apps');
  expect(mocks.opened).toEqual([]);
  expect(mocks.library).toEqual([]);
});

it('opens an app being built at its build route', async () => {
  mocks.activeView = { kind: 'apps', route: 'build/source-1' };
  const { AppsShell } = await import('./apps-shell');
  renderToStaticMarkup(<AppsShell route="build/source-1" />);
  expect(mocks.builds).toEqual(['source-1']);
});
