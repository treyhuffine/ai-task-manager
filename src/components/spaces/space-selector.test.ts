import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

await vi.hoisted(async () => {
  const { parseHTML } = await import('linkedom');
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
});

const mocks = vi.hoisted(() => ({ list: vi.fn(), assign: vi.fn() }));
vi.mock('@/lib/spaces/my-ri-client', () => ({ myRiClient: { spaces: { list: { query: mocks.list } } } }));
vi.mock('@/lib/spaces/client-cache', () => ({ teamConnectionsKey: () => ['teams'] }));
import { SpaceSelector } from './space-selector';

let root: Root;
let qc: QueryClient;
let storage: Map<string, string>;
const teamId = 'team-fixture';
beforeEach(() => {
  vi.resetAllMocks();
  const { window, document } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
  for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'CustomEvent', 'Event', 'MutationObserver']) {
    vi.stubGlobal(name, name === 'window' ? window : name === 'document' ? document : window[name as keyof typeof window]);
  }
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('getComputedStyle', (element: HTMLElement) => ({ display: element.style.display || 'block', visibility: 'visible', position: 'static', direction: 'ltr', overflow: 'visible', overflowX: 'visible', overflowY: 'visible', getPropertyValue: () => '' }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { pathname: `/space/${teamId}`, search: '?view=notes', assign: mocks.assign } });
  document.documentElement.dataset.riSpace = teamId;
  storage = new Map([['ri:space-nav:my-ri', '/?view=tasks']]);
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  mocks.list.mockResolvedValue([{ id: teamId, name: 'Team Huffine', status: 'active' }]);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  await settle();
  qc.clear();
  vi.unstubAllGlobals();
});
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function render(variant: 'wide' | 'collapsed' | 'phone') {
  await act(async () => root.render(createElement(QueryClientProvider, { client: qc }, createElement(SpaceSelector, { variant }))));
  await settle();
}
async function openMenu() {
  const trigger = document.querySelector<HTMLButtonElement>('[aria-label$="Switch space"]')!;
  expect(trigger).not.toBeNull();
  await act(async () => trigger.dispatchEvent(Object.assign(new window.Event('pointerdown', { bubbles: true }), { button: 0, ctrlKey: false, pointerType: 'mouse' })));
  await settle();
}

it.each(['wide', 'collapsed', 'phone'] as const)('switches back to My Ri from the %s selector', async variant => {
  await render(variant);
  await openMenu();
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(el => el.textContent === 'My Ri');
  expect(item, document.body.innerHTML).toBeDefined();
  await act(async () => item!.click());
  expect(mocks.assign).toHaveBeenCalledWith('/?view=tasks');
  expect(storage.get(`ri:space-nav:${teamId}`)).toBe(`/space/${teamId}?view=notes`);
});
