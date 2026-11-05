import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { TeamDashboardBoundary } from './team-dashboard-boundary';
import { useSettingsLink } from '@/components/settings/settings-destination';
import { useChatCapabilities } from '@/components/chat-ui/chat-capabilities';
const viewer = vi.hoisted(() => ({ canConfigure: false }));
vi.mock('./home-context', () => ({ useHomeContext: () => ({ capabilities: { configureAgents: viewer.canConfigure } }) }));
vi.mock('@/components/team/team-context', () => ({ useTeam: () => ({ team: { name: 'Shared Team' } }), useTeamNav: () => ({ openSettings() {}, openPanel() {} }) }));
vi.mock('@/components/tasks/lifecycle-guard', () => ({ LifecycleGuardProvider: ({ children }: { children: ReactNode }) => children }));
it('supplies shared-chat policy while the personal defaults retain their behavior', () => {
  const seen: unknown[] = [];
  function Capture() { seen.push(useChatCapabilities()); return null; }
  renderToStaticMarkup(createElement(TeamDashboardBoundary, null, createElement(Capture)));
  renderToStaticMarkup(createElement(Capture));
  expect(seen).toEqual([{ deliveryReceipts: false, prepareResults: true, coordination: false }, { deliveryReceipts: true, prepareResults: true }]);
});
it('offers model administration only to an authorized owner', () => {
  const seen: boolean[] = [];
  function Capture() { seen.push(Boolean(useSettingsLink('models'))); return null; }
  viewer.canConfigure = false;
  renderToStaticMarkup(createElement(TeamDashboardBoundary, null, createElement(Capture)));
  viewer.canConfigure = true;
  renderToStaticMarkup(createElement(TeamDashboardBoundary, null, createElement(Capture)));
  expect(seen).toEqual([false, true]);
  viewer.canConfigure = false;
});
