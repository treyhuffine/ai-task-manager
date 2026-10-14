import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ owner: true, enabled: false, ready: false }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}), useMutation: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => vi.fn() }));
vi.mock('./team-context', () => ({ useTeam: () => ({ team: { name: 'Team Huffine' }, member: { role: state.owner ? 'owner' : 'member' } }) }));
vi.mock('./team-chat', () => ({ useTeamAiStatus: () => ({ data: { enabled: state.enabled, state: state.enabled ? (state.ready ? 'ready' : 'needs_sign_in') : 'off', reason: 'Sign in on the host.' } }) }));
import { TeamAiSection } from './team-ai-settings';
afterEach(() => Object.assign(state, { owner: true, enabled: false, ready: false }));
it('lets the owner turn AI on without an account-label or API-key form', () => {
  const html = renderToStaticMarkup(createElement(TeamAiSection));
  expect(html).toContain('Turn on');
  expect(html).toContain('subscription');
  expect(html).not.toContain('type="password"');
  expect(html).not.toContain('API key');
  expect(html).not.toContain('>Account<');
});
it('shows how to recover a missing host sign-in', () => {
  state.enabled = true;
  const html = renderToStaticMarkup(createElement(TeamAiSection));
  expect(html).toContain('Check sign-in');
  expect(html).toContain('claude auth login');
});
it('shows shared subscription usage to members without owner controls', () => {
  Object.assign(state, { owner: false, enabled: true, ready: true });
  const html = renderToStaticMarkup(createElement(TeamAiSection));
  expect(html).toContain('counts toward');
  expect(html).not.toContain('<button');
});
