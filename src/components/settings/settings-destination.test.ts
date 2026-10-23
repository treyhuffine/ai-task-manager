import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TeamWorkBoundary } from '@/components/home/team-work-boundary';
import { closeSettings, useSettingsStore } from './settings-store';
import { useSettingsLink } from './settings-destination';

vi.mock('@/components/home/home-context', () => ({ useHomeContext: () => ({ capabilities: { configureAgents: true } }) }));
const fixture = vi.hoisted(() => ({ openSettings: vi.fn() }));
vi.mock('@/components/team/team-context', () => ({ useTeamNav: () => ({ openSettings: fixture.openSettings }) }));
vi.mock('@/hooks/use-workspaces', () => ({ useRailSessions: () => ({ data: {} }) }));
vi.mock('@/hooks/use-global-session-stream', () => ({ useGlobalSessionStream: () => {} }));
afterEach(() => { fixture.openSettings.mockReset(); closeSettings(); });

function destinations(shared: boolean) {
  const capture = vi.fn<(value: {models: ReturnType<typeof useSettingsLink>; skills: ReturnType<typeof useSettingsLink>; remote: ReturnType<typeof useSettingsLink>; current: ReturnType<typeof useSettingsStore>}) => void>();
  function Capture() {
    const models = useSettingsLink('models'), skills = useSettingsLink('plugins', { anchor: 'skills' }), remote = useSettingsLink('remote-preview'), current = useSettingsStore();
    capture({models,skills,remote,current}); return null;
  }
  renderToStaticMarkup(shared ? createElement(TeamWorkBoundary, null, createElement(Capture)) : createElement(Capture));
  return capture.mock.calls.at(-1)![0];
}

it('routes shared settings links through the owning Team document and withholds host provider setup', () => {
  const links = destinations(true); links.models!(); links.skills!();
  expect(fixture.openSettings.mock.calls).toEqual([['ai'], ['skills']]); expect(links.remote).toBeNull();
  expect(destinations(false).current.open).toBe(false);
});

it('preserves personal settings and section anchors', () => {
  destinations(false).skills!();
  expect(destinations(false).current).toMatchObject({ open: true, section: 'plugins', anchor: 'skills' });
  destinations(false).models!(); expect(destinations(false).current.section).toBe('models');
});
