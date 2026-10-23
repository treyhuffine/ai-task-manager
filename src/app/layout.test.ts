import { isValidElement, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

const authority = vi.hoisted(() => ({ team: vi.fn(), space: vi.fn(), initial: vi.fn() }));
vi.mock('@/lib/home/context', () => ({ initialHomeContextForRequest: authority.initial }));
vi.mock('@/lib/team/page-authority', () => ({ isTeamPage: authority.team }));
vi.mock('@/lib/spaces/page', () => ({ spacePage: authority.space }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/db/queries', () => ({ getHome: () => ({ id: 'fixture-home' }), getTeamConnection: () => ({ memberId: 'connected-member' }) }));
vi.mock('next/font/google', () => ({ Inter: () => ({ variable: 'font' }) }));
vi.mock('@/providers/query-provider', () => ({ QueryProvider: 'query-provider' }));
vi.mock('@/components/ui/tip', () => ({ TipProvider: 'tip-provider' }));
vi.mock('@/components/ui/sonner', () => ({ Toaster: 'toaster' }));
vi.mock('@/components/ui/confirm-dialog', () => ({ ConfirmProvider: 'confirm-provider' }));
vi.mock('@/components/auth/pairing-bootstrap', () => ({ PairingBootstrap: 'pairing-bootstrap' }));
vi.mock('@/components/app/home-reachability-banner', () => ({ HomeReachabilityBanner: 'home-reachability-banner' }));
vi.mock('@/components/app/home-environment-marker', () => ({ HomeEnvironmentMarker: 'home-environment-marker' }));
vi.mock('@/components/tasks/lifecycle-guard', () => ({ LifecycleGuardProvider: 'lifecycle-guard' }));
vi.mock('@/components/desktop/desktop-chrome', () => ({ DesktopChrome: 'desktop-chrome' }));
vi.mock('@/components/desktop/service-connection', () => ({ ServiceConnection: 'service-connection' }));
vi.mock('@/components/settings/phone-install', () => ({ WebAppBootstrap: 'web-app-bootstrap' }));
vi.mock('@/components/dashboard/quick-capture-host', () => ({ QuickCaptureHost: 'quick-capture-host' }));
vi.mock('@/components/team/team-root', () => ({ TeamRoot: 'team-root' }));
vi.mock('@/components/chat-ui/artifacts/artifact-preview-provider', () => ({ ArtifactPreviewProvider: 'artifact-preview-provider' }));
vi.mock('@/components/spaces/space-root', () => ({ SpaceRoot: 'space-root' }));
import RootLayout from './layout';

function components(node: ReactNode): unknown[] {
  if (Array.isArray(node)) return node.flatMap(components);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node.type, ...components(node.props.children)];
}
afterEach(() => vi.resetAllMocks());

it.each(['personal', 'team', 'space'])('mounts exactly one desktop navigation guard on %s pages', async kind => {
  authority.team.mockResolvedValue(kind === 'team');
  authority.space.mockResolvedValue(kind === 'space' ? { id: 'team-fixture', status: 'active' } : null);
  const tree = components(await RootLayout({ children: 'page' }));
  expect(tree.filter(type => type === 'desktop-chrome')).toHaveLength(1);
  for (const personal of ['pairing-bootstrap', 'service-connection', 'quick-capture-host', 'web-app-bootstrap', 'home-reachability-banner']) {
    expect(tree.includes(personal), personal).toBe(kind === 'personal');
  }
});

it.each(['personal', 'team', 'space'])('only bootstraps the authenticated server Home on %s pages', async kind => {
  authority.team.mockResolvedValue(kind === 'team');
  authority.space.mockResolvedValue(kind === 'space' ? { id: 'remote-team', status: 'active' } : null);
  const initial = { home: { id: 'server-home' }, viewer: { id: 'authenticated-viewer' } };
  authority.initial.mockResolvedValue(initial);
  const layout = await RootLayout({ children: 'page' });
  function find(node: ReactNode): unknown {
    if (Array.isArray(node)) return node.map(find).find(Boolean);
    if (!isValidElement<{ children?: ReactNode; initialHomeContext?: unknown }>(node)) return undefined;
    return node.type === 'query-provider' ? node.props : find(node.props.children);
  }
  expect(find(layout)).toMatchObject({ initialHomeContext: kind === 'space' ? undefined : initial });
  expect(authority.initial).toHaveBeenCalledTimes(kind === 'space' ? 0 : 1);
});

it.each(['disconnected', 'revoked'])('keeps the desktop guard outside the %s team gate', async status => {
  authority.team.mockResolvedValue(false);
  authority.space.mockResolvedValue({ id: 'team-fixture', status });
  const layout = await RootLayout({ children: 'page' });
  const tree = components(layout);
  expect(tree.indexOf('desktop-chrome')).toBeLessThan(tree.indexOf('space-root'));
  expect(tree).not.toContain('service-connection');
});
