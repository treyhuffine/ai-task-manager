vi.mock('@/components/home/home-context', () => ({ useHomeContext: () => ({ capabilities: { administerMembers: mocks.role === 'owner', configureAgents: mocks.role === 'owner' } }) }));
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createLink: vi.fn(), done: vi.fn(), remoteSetup: false, role: 'owner', initialSection: 'general' }));
vi.mock('@/lib/trpc/client', () => {
  const list = { queryOptions: () => ({ queryKey: ['test-empty'], queryFn: async () => [] }) };
  return {
    trpc: { team: { invitations: { list }, signIns: { list } } },
    trpcClient: { team: { invitations: { createRemote: { mutate: mocks.createLink } }, signIns: { createRemote: { mutate: mocks.createLink } } } },
  };
});
vi.mock('./team-context', () => ({
  useTeam: () => ({ team: { name: 'Team Huffine' }, member: { id: 'owner', name: 'Trey', role: mocks.role } }),
  useTeamNav: () => {
    const [settingsSection, openSettings] = useState(mocks.initialSection);
    return { panel: 'settings', settingsSection, openSettings, remoteSetup: mocks.remoteSetup, finishRemoteSetup: mocks.done };
  },
}));
vi.mock('./team-address-setup', () => ({ TeamAddressSetup: ({ onDone }: { onDone?: () => void }) => createElement('button', { onClick: onDone }, 'Remote address setup') }));
vi.mock('./connect-ai', () => ({ ConnectAiSection: () => createElement('div', null, 'Connect your AI') }));
vi.mock('./team-ai-settings', () => ({ TeamAiSection: () => createElement('div', null, 'Team AI') }));
vi.mock('./team-areas', () => ({ NewAreaDialog: () => null }));
vi.mock('./use-team', () => ({ useTeamMembers: () => ({ active: [] }) }));
vi.mock('@/hooks/use-areas', () => ({ useAreas: () => ({ data: [] }), useUpdateArea: () => ({}) }));
vi.mock('@/components/spaces/space-root', () => ({ useSpace: () => null }));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/ui/dialog', () => {
  const container = ({ children }: { children: React.ReactNode }) => createElement('div', null, children);
  return { Dialog: container, DialogContent: container, DialogHeader: container, DialogTitle: container, DialogDescription: container };
});
vi.mock('@/lib/team/client', () => ({ forgetTeamSignIn: vi.fn() }));
import { TeamSettings } from './team-settings';

let root: Root;
let container: HTMLElement;
let qc: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.remoteSetup = false;
  mocks.role = 'owner';
  mocks.initialSection = 'general';
  mocks.createLink.mockResolvedValue({ link: 'https://localhost:42242/join#sign-in=secret', reachable: false, expiresAt: '2030-01-01' });
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  // Radix's form bridge uses the native checked setter, absent in linkedom.
  Object.defineProperty(window.HTMLInputElement.prototype, 'checked', {
    configurable: true, get() { return this.hasAttribute('checked'); },
    set(value: boolean) { if (value) this.setAttribute('checked', ''); else this.removeAttribute('checked'); },
  });
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('Event', window.Event);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  root = createRoot(container);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  qc.clear();
  vi.unstubAllGlobals();
});
async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 15)); }); }
async function render() {
  await act(async () => root.render(createElement(QueryClientProvider, { client: qc }, createElement(TeamSettings))));
  await settle();
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes(label));
  expect(button).toBeDefined();
  await act(async () => button!.click());
  await settle();
}

it('offers provider-neutral prefix setup after owner creation', async () => {
  mocks.remoteSetup = true;
  await render();
  expect(container.textContent).toContain('Choose a team prefix');
  expect(container.textContent).not.toContain('Invite people');
  expect(container.textContent).not.toContain('Connect to My Ri');
  expect(container.textContent).not.toContain('Connect your AI');
  expect(container.textContent).not.toContain('Team AI');
  await click('Remote address setup');
  expect(mocks.done).toHaveBeenCalledOnce();
});

it('separates built-in AI, external assistants and remote access into named sections', async () => {
  await render();
  expect(container.textContent).not.toContain('Connect your AI');
  expect(container.textContent).not.toContain('Remote address setup');
  expect(container.querySelector('nav [aria-current=page]')?.textContent).toBe('General');
  await click('AI & Models');
  expect(container.querySelector<HTMLElement>('[data-team-settings-section=ai]')?.hidden).toBe(false);
  expect(container.querySelector<HTMLElement>('[data-team-settings-section=ai]')?.textContent).toBe('Team AI');
  expect(container.textContent).not.toContain('Connect your AI');
  await click('Connect your agent');
  expect(container.querySelector<HTMLElement>('[data-team-settings-section=ai]')?.hidden).toBe(true);
  expect(container.querySelector<HTMLElement>('[data-team-settings-section=external-ai]')?.textContent).toBe('Connect your AI');
  await click('Remote access');
  expect(container.querySelector<HTMLElement>('[data-team-settings-section=remote]')?.textContent).toBe('Remote address setup');
});

it.each(['unknown', 'remote'])('falls back safely for a member opening the %s section', async section => {
  mocks.role = 'member';
  mocks.initialSection = section;
  await render();
  expect(container.querySelector('nav [aria-current=page]')?.textContent).toBe('General');
  expect(container.textContent).not.toContain('Remote address setup');
  expect(container.querySelector('nav')?.textContent).not.toContain('Remote access');
});

it('opens a linked settings section directly', async () => {
  mocks.initialSection = 'ai';
  await render();
  expect(container.querySelector('nav [aria-current=page]')?.textContent).toBe('AI & Models');
  expect(container.querySelector<HTMLElement>('[data-team-settings-section=ai]')?.textContent).toBe('Team AI');
});

it.each(['Invite people', 'Sign in on another device', 'Connect to My Ri'])('asks for remote setup instead of copying a localhost link for %s', async (label) => {
  await render();
  await click(label === 'Invite people' ? 'People' : 'Your access');
  await click(label);
  expect(mocks.createLink).toHaveBeenCalledOnce();
  expect(container.textContent).toContain('Set up or reconnect a remote address here');
  expect(container.textContent).not.toContain('localhost:42242/join');
  expect(container.querySelector('code')).toBeNull();
});

it.each(['Invite people', 'Sign in on another device', 'Connect to My Ri'])('handles the remote-address precondition before creating a link for %s', async (label) => {
  mocks.createLink.mockRejectedValueOnce(Object.assign(new Error('Set up a reachable address'), { status: 412 }));
  await render();
  await click(label === 'Invite people' ? 'People' : 'Your access');
  await click(label);
  expect(mocks.createLink).toHaveBeenCalledOnce();
  expect(container.textContent).toContain('Set up or reconnect a remote address here');
  expect(container.querySelector('code')).toBeNull();
});

it('shows a reachable link with the instructions for the chosen destination', async () => {
  mocks.createLink.mockResolvedValue({ link: 'https://team-huffine-trey.beamd.run/join#sign-in=secret', reachable: true });
  await render();
  await click('Your access');
  await click('Connect to My Ri');
  expect(container.querySelector('code')?.textContent).toBe('https://team-huffine-trey.beamd.run/join#sign-in=secret');
  expect(container.textContent).toContain('paste it in your own Ri');
});

it('asks a regular member to contact an owner instead of exposing host settings', async () => {
  mocks.role = 'member';
  await render();
  await click('Your access');
  await click('Sign in on another device');
  expect(container.textContent).toContain('Ask a team owner');
  expect(container.textContent).not.toContain('Remote address setup');
  expect(container.querySelector('code')).toBeNull();
});
