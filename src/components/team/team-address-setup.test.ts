import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), open: vi.fn(), set: vi.fn(), done: vi.fn() }));
vi.mock('@/lib/trpc/client', () => ({
  trpc: { team: { address: { get: { queryOptions: () => ({ queryKey: ['test-team-address'], queryFn: mocks.get }) } } } },
  trpcClient: { team: { address: { configureBeamd: { mutate: mocks.open }, set: { mutate: mocks.set } } } },
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
async function render() {
  await act(async () => root.render(createElement(QueryClientProvider, { client: qc }, createElement(TeamAddressSetup, { onDone: mocks.done }))));
  await settle();
}
async function submit() {
  await act(async () => container.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  await settle();
}

it('offers the chosen team name and a local-only choice before making any address', async () => {
  await render();
  expect(container.querySelector<HTMLInputElement>('#team-address-prefix')?.value).toBe('team-huffine');
  expect(container.textContent).toContain('before inviting people');
  expect(mocks.open).not.toHaveBeenCalled();
  const skip = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Use only on this computer for now')!;
  await act(async () => skip.click());
  expect(mocks.done).toHaveBeenCalledOnce();
  expect(mocks.open).not.toHaveBeenCalled();
});

it('saves the selected prefix and shows the returned address before continuing', async () => {
  await render();
  mocks.get.mockResolvedValue({ ...local, address: 'https://team-huffine-trey.beamd.run', tunnelName: 'team-huffine', autoTunnel: true });
  await submit();
  expect(mocks.open).toHaveBeenCalledWith({ name: 'team-huffine' });
  expect(container.textContent).toContain('https://team-huffine-trey.beamd.run');
  expect(container.textContent).toContain('Continue to team');
  expect(mocks.done).not.toHaveBeenCalled();
});

it('keeps a name conflict visible and lets the owner retry without losing the choice', async () => {
  mocks.open.mockRejectedValueOnce(new Error('That name is already taken.'));
  await render();
  await submit();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('name is already taken');
  expect(container.querySelector<HTMLInputElement>('#team-address-prefix')?.value).toBe('team-huffine');
  await submit();
  expect(mocks.open).toHaveBeenCalledTimes(2);
});

it('shows the existing prefix for editing and respects a host-controlled name', async () => {
  mocks.get.mockResolvedValue({ ...local, address: 'https://ri-team-dvcy-trey.beamd.run', nameLocked: true });
  await render();
  const input = container.querySelector<HTMLInputElement>('#team-address-prefix')!;
  expect(input.value).toBe('ri-team-dvcy');
  expect(input.disabled).toBe(true);
  expect(container.textContent).toContain('Expected address: https://ri-team-dvcy-trey.beamd.run');
});
