import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RiDesktop } from '@/lib/client/desktop';
import type { DesktopDeviceSettingsStatus } from '@/lib/client/desktop-device-settings';
import { ThisComputerSection } from './this-computer-section';

const mocks = vi.hoisted(() => ({ homeComputer: vi.fn() }));
vi.mock('@/lib/trpc/client', () => ({ trpcClient: { service: { computerGet: { query: mocks.homeComputer } } } }));

let root: Root;
let container: HTMLElement;
let client: QueryClient;
const state: DesktopDeviceSettingsStatus = {
  role: 'viewer', appVersion: 'local-desktop', runtimeVersion: 'local-runtime',
  home: { name: 'My Ri', hostName: 'AI Mac Mini' }, startsAtLogin: false,
  serviceAvailable: true, preferences: null, update: { phase: 'idle', configured: false },
};
beforeEach(() => {
  vi.clearAllMocks();
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  // Radix's form bridge uses the native checked setter, absent in linkedom.
  Object.defineProperty(window.HTMLInputElement.prototype, 'checked', {
    configurable: true, get() { return this.hasAttribute('checked'); },
    set(value: boolean) { if (value) this.setAttribute('checked', ''); else this.removeAttribute('checked'); },
  });
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('Event', window.Event);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); vi.unstubAllGlobals(); });
async function mount(request: RiDesktop['deviceSettings']) {
  window.riDesktop = { platform: 'darwin', deviceSettings: request } as RiDesktop;
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(ThisComputerSection))));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
}
function button(text: string) { return [...container.querySelectorAll('button')].find(element => element.textContent === text)!; }

it('reads and enables the local worker from the tab, without querying the remote Home service', async () => {
  const request = vi.fn().mockResolvedValueOnce(state).mockResolvedValue({ ...state, role: 'worker', worker: { state: 'connected', enabled: true } });
  await mount(request);
  expect(container.textContent).toContain('local-desktop');
  expect(container.textContent).toContain('Connected to My Ri on AI Mac Mini');
  expect(container.textContent).toContain('Local execution is off');
  expect(mocks.homeComputer).not.toHaveBeenCalled();
  await act(async () => button('Enable local execution').click());
  expect(request.mock.calls).toEqual([[{ type: 'status' }], [{ type: 'enable-worker' }]]);
  expect(container.textContent).toContain('This computer can run agents');
  expect(button('Stop local execution')).toBeDefined();
});

it('explains manual builds and exposes the actual compatibility blocker', async () => {
  await mount(vi.fn().mockResolvedValue({ ...state, role: 'worker', worker: {
    state: 'update-required', enabled: true, error: 'Update Ri on Mac M3.',
  } }));
  expect(container.textContent).toContain('Update required before agents can run here');
  expect(container.textContent).toContain('Update Ri on Mac M3');
  expect(container.textContent).toContain('This build updates manually');
  expect(button('Check for updates')).toBeUndefined();
});

it('uses the local updater when a release feed is configured', async () => {
  const request = vi.fn().mockResolvedValue({ ...state, update: { phase: 'available', configured: true } });
  await mount(request);
  expect(button('Download update')).toBeDefined();
  await act(async () => button('Download update').click());
  expect(request).toHaveBeenLastCalledWith({ type: 'update-download' });
  expect(mocks.homeComputer).not.toHaveBeenCalled();
});

it('retains local controls after a failed mutation and permits a retry', async () => {
  const request = vi.fn().mockResolvedValueOnce(state).mockRejectedValueOnce(new Error('The local service is restarting.')).mockResolvedValue(state);
  await mount(request);
  await act(async () => button('Enable local execution').click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('The local service is restarting');
  expect(button('Enable local execution').disabled).toBe(false);
  await act(async () => button('Enable local execution').click());
  expect(request).toHaveBeenCalledTimes(3);
});

it('older remote desktop shells keep their local settings fallback without showing the Home as this computer', async () => {
  const connection = vi.fn();
  window.riDesktop = { platform: 'darwin', connection } as unknown as RiDesktop;
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(ThisComputerSection))));
  expect(container.textContent).toContain('Update the Ri desktop app');
  expect(button('Open desktop settings')).toBeDefined();
  expect(mocks.homeComputer).not.toHaveBeenCalled();
});
