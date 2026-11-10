import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { act, createElement, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RiDesktop } from '@/lib/client/desktop';
import { DesktopControls } from './desktop-controls';
import { DesktopSettings } from './sections/desktop-settings';
import { DevicesSettingsSection } from './sections/devices-section';
import { closeSettings, useSettingsStore } from './settings-store';

vi.mock('@/components/settings/remote-base-url', () => ({ RemoteBaseUrlSection: () => null }));
vi.mock('@/components/settings/devices-section', () => ({ DevicesSection: () => null }));
vi.mock('@/components/settings/client-settings', () => ({ ClientSettings: () => null }));
vi.mock('@/components/settings/phone-install', () => ({ PhoneInstall: () => null }));
vi.mock('./sections/host-availability', () => ({ HostAvailability: () => null }));

let root: Root;
let container: HTMLElement;
let client: QueryClient;

beforeEach(() => {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  delete window.riDesktop;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  closeSettings();
  vi.unstubAllGlobals();
});

it('opens the This computer tab in a current desktop shell', async () => {
  const connection = remoteDesktop();
  window.riDesktop!.deviceSettings = vi.fn();
  function Preview() {
    const state = useSettingsStore();
    return createElement('div', null, createElement(DesktopControls), createElement('output', null, state.section));
  }
  await mount(Preview);
  await act(async () => container.querySelector('button')!.click());
  expect(container.querySelector('output')?.textContent).toBe('this-computer');
  expect(connection).not.toHaveBeenCalled();
});

async function mount(Component: ComponentType) {
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Component))));
}

function remoteDesktop(connection = vi.fn().mockResolvedValue({ phase: 'connected', issue: null, showNotice: false })) {
  // Connected Home pages have the connection bridge, without local preferences access.
  window.riDesktop = { platform: 'darwin', connection } as unknown as RiDesktop;
  return connection;
}

it.each([
  ['Devices', DevicesSettingsSection],
  ['General', DesktopSettings],
] as const)('opens local desktop controls from %s when viewing a remote Home', async (_name, Component) => {
  const connection = remoteDesktop();
  await mount(Component);
  const button = container.querySelector('button')!;
  expect(button.textContent).toBe('Open desktop settings');
  expect(container.textContent).toContain('Enable agents on this computer');
  expect(container.textContent).not.toContain('Reading desktop settings');
  await act(async () => button.click());
  expect(connection).toHaveBeenCalledExactlyOnceWith('settings');
});

it.each([DevicesSettingsSection, DesktopSettings])('hides native controls in an ordinary browser', async Component => {
  await mount(Component);
  expect(container.querySelector('button')).toBeNull();
  expect(container.textContent).not.toContain('Reading desktop settings');
});

it('shows an opening failure and allows retry without leaving settings', async () => {
  let fail!: (cause: Error) => void;
  const connection = remoteDesktop(vi.fn().mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }))
    .mockResolvedValue({ phase: 'connected', issue: null, showNotice: false }));
  await mount(DesktopControls);
  const button = container.querySelector('button')!;
  await act(async () => button.click());
  expect(button.disabled).toBe(true);
  expect(button.textContent).toBe('Opening desktop settings…');
  await act(async () => fail(new Error('Finish your voice recording before opening desktop settings.')));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Finish your voice recording');
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(connection.mock.calls).toEqual([['settings'], ['settings']]);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
