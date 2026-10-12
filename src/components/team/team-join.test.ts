import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  previewTeamLink: vi.fn(), readSetupAttempt: vi.fn(), finishTeamSetup: vi.fn(),
  keepTeamSignIn: vi.fn(), replace: vi.fn(),
}));
vi.mock('@/lib/api/client', () => ({ getAuthToken: () => null }));
vi.mock('@/lib/trpc/client', () => ({ trpcClient: {} }));
vi.mock('@/lib/team/client', () => ({
  ...mocks, joinTeam: vi.fn(), signInToTeam: vi.fn(), teamInfo: vi.fn(),
  TeamRequestError: class extends Error {}, TeamUnreachableError: class extends Error {},
}));
import { TeamJoin } from './team-join';

let root: Root;
let container: HTMLElement;
const secret = 'rtg_owner_setup_fixture';

beforeEach(() => {
  vi.clearAllMocks();
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  Object.defineProperty(window, 'location', { configurable: true, value: { hash: `#setup=${secret}`, search: '', host: 'localhost:43333', replace: mocks.replace } });
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  root = createRoot(container);
  mocks.readSetupAttempt.mockReturnValue(null);
  mocks.previewTeamLink.mockResolvedValue({ kind: 'team', state: 'valid', team: { id: 'team', name: 'Team Huffine' }, member: null, expiresAt: null });
  mocks.finishTeamSetup.mockResolvedValue({ token: 'member-token' });
  mocks.keepTeamSignIn.mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(createElement(TeamJoin)));
}

it('fills the owner form with the team name already chosen at creation', async () => {
  await render();
  expect(container.querySelector<HTMLInputElement>('#team-name')?.value).toBe('Team Huffine');
  expect(container.querySelector<HTMLInputElement>('#owner-name')?.value).toBe('');
  expect(container.textContent).toContain('Connecting your personal Ri later keeps this same membership.');
  expect(container.textContent).toContain('Connect to My Ri');
});

it('preserves the saved setup attempt when its response was lost, including an edited name', async () => {
  mocks.readSetupAttempt.mockReturnValue({ attemptId: 'a'.repeat(32), teamName: 'Edited Team', ownerName: 'Trey' });
  await render();
  expect(container.querySelector<HTMLInputElement>('#team-name')?.value).toBe('Edited Team');
  expect(container.querySelector<HTMLInputElement>('#owner-name')?.value).toBe('Trey');
  await act(async () => container.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  expect(mocks.finishTeamSetup).toHaveBeenCalledWith(secret, 'Edited Team', 'Trey');
  expect(mocks.keepTeamSignIn).toHaveBeenCalledWith('member-token');
  expect(mocks.replace).toHaveBeenCalledWith('/');
});
