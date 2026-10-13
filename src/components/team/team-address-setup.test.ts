import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), open: vi.fn(), set: vi.fn(), prefix: vi.fn(), done: vi.fn() }));
vi.mock('@/lib/trpc/client', () => ({
  trpc: { team: { address: { get: { queryOptions: () => ({ queryKey: ['test-team-address'], queryFn: mocks.get }) } } } },
  trpcClient: { team: { address: { configureBeamd: { mutate: mocks.open }, set: { mutate: mocks.set }, savePrefix: { mutate: mocks.prefix } } } },
}));
vi.mock('@/lib/api/client', () => ({ apiErrorText: (err: Error) => err.message }));
import { TeamAddressSetup } from './team-address-setup';

let root: Root;
let container: HTMLElement;
let qc: QueryClient;
const local = { address: null, local: 'https://localhost:42242', autoTunnel: false, tunnelName: 'ri-team-dvcy', suggestedName: 'team-huffine', nameLocked: false };

beforeEach(() => {
  vi.resetAllMocks();
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  root = createRoot(container);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  mocks.get.mockResolvedValue(local);
  mocks.open.mockResolvedValue({ address: 'https://team-huffine-trey.beamd.run' });
});
afterEach(async () => {
  await act(async () => root.unmount());
  qc.clear();
  vi.unstubAllGlobals();
});
async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 15)); }); }
async function render(setup = false) {
  await act(async () => root.render(createElement(QueryClientProvider, { client: qc }, createElement(TeamAddressSetup, { onDone: setup ? mocks.done : undefined }))));
  await settle();
}
async function submit() {
  await act(async () => container.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  await settle();
}

async function choose(label: string) {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent === label)!;
  expect(button).toBeDefined();
  await act(async () => button.click());
  await settle();
}

it('asks only for a prefix during setup and allows deciding later', async () => {
  await render(true);
  expect(container.querySelector<HTMLInputElement>('#team-address-prefix')?.value).toBe('team-huffine');
  expect(container.textContent).toContain('Where people reach the team');
  expect(container.textContent).not.toContain('Beamd');
  expect(container.querySelector('#team-custom-address')).toBeNull();
  await choose('Decide later');
  expect(mocks.done).toHaveBeenCalledOnce();
  expect(mocks.prefix).not.toHaveBeenCalled();
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.set).not.toHaveBeenCalled();
});

it('saves the setup prefix without contacting a remote service, then continues', async () => {
  await render(true);
  await submit();
  expect(mocks.prefix).toHaveBeenCalledWith({ name: 'team-huffine' });
  expect(mocks.done).toHaveBeenCalledOnce();
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.set).not.toHaveBeenCalled();
});

it('keeps setup open when the prefix could not be saved', async () => {
  mocks.prefix.mockRejectedValueOnce(new Error('Could not save the prefix.'));
  await render(true);
  await submit();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not save the prefix');
  expect(mocks.done).not.toHaveBeenCalled();
  expect(mocks.open).not.toHaveBeenCalled();
  await submit();
  expect(mocks.done).toHaveBeenCalledOnce();
});

it('leaves existing remote access intact when revisiting setup', async () => {
  mocks.get.mockResolvedValue({ ...local, address: 'https://team.example.com' });
  await render(true);
  expect(container.querySelector('form')).toBeNull();
  await choose('Continue to team');
  expect(mocks.done).toHaveBeenCalledOnce();
  expect(mocks.prefix).not.toHaveBeenCalled();
});

it('offers both methods in Settings without selecting or connecting either', async () => {
  await render();
  const methods = container.querySelectorAll('[aria-pressed="false"]');
  expect(methods).toHaveLength(2);
  expect(container.querySelector('form')).toBeNull();
  await choose('Use an HTTPS address');
  expect(container.querySelector('#team-custom-address')).not.toBeNull();
  expect(container.querySelector('#team-address-prefix')).toBeNull();
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.set).not.toHaveBeenCalled();
});

it('uses the prefix saved in setup when Beamd is chosen later', async () => {
  mocks.get.mockResolvedValue({ ...local, tunnelName: 'huffines', suggestedName: 'huffines' });
  await render();
  await choose('Use Beamd');
  expect(container.querySelector<HTMLInputElement>('#team-address-prefix')?.value).toBe('huffines');
  await submit();
  expect(mocks.open).toHaveBeenCalledWith({ name: 'huffines' });
});

it('opens the selected Beamd prefix and shows the returned address in Settings', async () => {
  await render();
  await choose('Use Beamd');
  mocks.get.mockResolvedValue({ ...local, address: 'https://team-huffine-trey.beamd.run', tunnelName: 'team-huffine', autoTunnel: true });
  await submit();
  expect(mocks.open).toHaveBeenCalledWith({ name: 'team-huffine' });
  expect(container.textContent).toContain('https://team-huffine-trey.beamd.run');
  expect(mocks.done).not.toHaveBeenCalled();
});

it('keeps a name conflict visible and lets the owner retry without losing the choice', async () => {
  mocks.open.mockRejectedValueOnce(new Error('That name is already taken.'));
  await render();
  await choose('Use Beamd');
  await submit();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('name is already taken');
  expect(container.querySelector<HTMLInputElement>('#team-address-prefix')?.value).toBe('team-huffine');
  await submit();
  expect(mocks.open).toHaveBeenCalledTimes(2);
});

it('shows the existing prefix for editing and respects a host-controlled name', async () => {
  mocks.get.mockResolvedValue({ ...local, address: 'https://ri-team-dvcy-trey.beamd.run', autoTunnel: true, nameLocked: true });
  await render();
  await choose('Use Beamd');
  const input = container.querySelector<HTMLInputElement>('#team-address-prefix')!;
  expect(input.value).toBe('ri-team-dvcy');
  expect(input.disabled).toBe(true);
  expect(container.textContent).toContain('Expected address: https://ri-team-dvcy-trey.beamd.run');
});

it('does not use a custom domain to predict a Beamd address', async () => {
  mocks.get.mockResolvedValue({ ...local, address: 'https://team-huffine.example.com', tunnelName: 'team-huffine' });
  await render();
  await choose('Use Beamd');
  expect(container.textContent).not.toContain('Expected address:');
  expect(container.textContent).toContain('Beamd adds its account and domain suffix');
});
