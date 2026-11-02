import { expect, it } from 'vitest';
import { teamDashboardView, teamHomePanels } from './team-dashboard';
import { viewFromSearchParams } from './active-view';
it.each([
  ['', { kind: 'home' }],
  ['view=notes', { kind: 'home' }],
  ['view=chat&chat=legacy', { kind: 'execution', id: 'legacy' }],
  ['chat=legacy', { kind: 'execution', id: 'legacy' }],
  ['view=agents&agent=one&agentTab=files', { kind: 'agent', id: 'one', tab: 'files' }],
  ['agent=one&tab=terminal&chat=two', { kind: 'agent', id: 'one', tab: 'terminal', chat: 'two' }],
  ['session=execution&agent=one', { kind: 'execution', id: 'execution' }],
])('preserves Team bookmarks %s', (search, expected) => expect(teamDashboardView(new URLSearchParams(search))).toEqual(expected));
it('retains personal parsing and default composition', () => {
  expect(viewFromSearchParams(new URLSearchParams('chat=legacy'))).toEqual({ kind: 'home' });
  expect(teamHomePanels(new URLSearchParams())).toEqual({ a: 'chat', b: 'tasks' });
  expect(teamHomePanels(new URLSearchParams('view=notes'))).toEqual({ a: 'chat', b: 'notes' });
});
