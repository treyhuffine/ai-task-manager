import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { _resetConnectivity, getConnectivity, reportNetworkFailure, reportReachable } from '@/lib/api/connectivity';
import { reportApiCompatibility } from '@/lib/client/api-compatibility';
import { API_PROTOCOL } from '@/lib/releases/api-contract';
import { ServiceConnection } from '@/components/desktop/service-connection';
import { HomeReachabilityBanner } from './home-reachability-banner';

const mocks = vi.hoisted(() => ({ version: vi.fn(), service: vi.fn(), health: vi.fn(), flush: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ api: { get: mocks.version }, getAuthToken: () => null }));
vi.mock('@/lib/trpc/client', () => ({ trpcClient: { service: { list: { query: mocks.service } }, home: { info: { query: vi.fn() } } } }));
vi.mock('@/lib/client/document-saves', () => ({ documentSaves: { flushAll: mocks.flush } }));
vi.mock('@/lib/client/version-reload', () => ({ reloadVersion: vi.fn() }));

let root: Root;
let container: HTMLElement;
let client: QueryClient;
let invalidate: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-07T12:00:00Z'));
  vi.clearAllMocks();
  _resetConnectivity();
  reportApiCompatibility(null);
  mocks.version.mockResolvedValue({ release: { build: 'test' }, apiProtocols: [API_PROTOCOL] });
  mocks.service.mockResolvedValue({ phase: 'running' });
  mocks.health.mockImplementation(async () => Response.json({ app: 'ri' }));
  mocks.flush.mockResolvedValue(undefined);
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  Object.assign(window, { localStorage: { getItem: () => JSON.stringify({ id: 'home', name: 'Home', host: { name: 'Mac Mini' } }) } });
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', mocks.health);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  invalidate = vi.spyOn(client, 'invalidateQueries');
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  _resetConnectivity();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () => root.render(createElement(QueryClientProvider, { client },
    createElement(Fragment, null, createElement(HomeReachabilityBanner), createElement(ServiceConnection),
      createElement('textarea', { defaultValue: 'Draft in progress', 'aria-label': 'Draft' })),
  )));
}
async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}
async function disconnect() {
  mocks.version.mockRejectedValue(new TypeError('Failed to fetch'));
  mocks.health.mockRejectedValue(new TypeError('Failed to fetch'));
  await act(async () => { await reportNetworkFailure(); });
}
const notice = () => container.querySelector('[role="status"]');

it('recovers from a short interruption without showing either connection warning', async () => {
  await mount();
  await disconnect();
  await advance(5_000);
  expect(notice()).toBeNull();
  mocks.health.mockImplementation(async () => Response.json({ app: 'ri' }));
  await advance(5_000);
  expect(getConnectivity().reachable).toBe(true);
  expect(notice()).toBeNull();
  expect(invalidate).toHaveBeenCalledOnce();
});

it('shows one nonmodal notice after ten seconds and retries without reloading or replacing a draft', async () => {
  await mount();
  const draft = container.querySelector('textarea')!;
  draft.value = 'Draft in progress';
  await disconnect();
  await advance(9_999);
  expect(notice()).toBeNull();
  await advance(1);
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  expect(notice()?.textContent).toContain('Reconnecting to Ri on Mac Mini');
  expect(document.body.inert).not.toBe(true);
  expect(draft.disabled).toBe(false);
  mocks.health.mockImplementation(async () => Response.json({ app: 'ri' }));
  await act(async () => container.querySelector('button')!.click());
  expect(notice()).toBeNull();
  expect(container.querySelector('textarea')).toBe(draft);
  expect(draft.value).toBe('Draft in progress');
  expect(invalidate).toHaveBeenCalledOnce();
});

it('gives a new interruption its own grace period and clears on any healthy request', async () => {
  await mount();
  await disconnect();
  await advance(10_000);
  expect(notice()).not.toBeNull();
  await act(async () => reportReachable());
  expect(notice()).toBeNull();
  expect(invalidate).toHaveBeenCalledOnce();
  await disconnect();
  await advance(5_000);
  expect(notice()).toBeNull();
  await advance(5_000);
  expect(notice()).not.toBeNull();
});

it.each(['online', 'focus'])('checks immediately on %s while an outage is still in its grace period', async event => {
  await mount();
  await disconnect();
  mocks.health.mockImplementation(async () => Response.json({ app: 'ri' }));
  await act(async () => window.dispatchEvent(new window.Event(event)));
  expect(getConnectivity().reachable).toBe(true);
  expect(notice()).toBeNull();
});

it('does not show a warning for slow service polling when health still answers', async () => {
  await mount();
  mocks.service.mockRejectedValue(new DOMException('Timed out', 'TimeoutError'));
  await advance(20_000);
  expect(mocks.health).toHaveBeenCalled();
  expect(getConnectivity().reachable).toBe(true);
  expect(notice()).toBeNull();
});

it('keeps compatibility errors visible immediately', async () => {
  await mount();
  await act(async () => reportApiCompatibility({ error: 'api_protocol', update: 'client', message: 'Reload Ri to use this version.' }));
  expect(notice()?.textContent).toContain('Reload Ri to use this version.');
  expect(container.querySelector('button')?.textContent).toBe('Reload with saved drafts');
});

it('waits for fresh confirmation after the grace period and ignores an obsolete failed check', async () => {
  await mount();
  await disconnect();
  await advance(5_000);
  let finish!: (response: Response) => void;
  mocks.health.mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
  await advance(5_000);
  expect(notice()).toBeNull();
  await act(async () => reportReachable());
  await act(async () => finish(new Response(null, { status: 503 })));
  expect(notice()).toBeNull();
  expect(getConnectivity().reachable).toBe(true);
  expect(invalidate).toHaveBeenCalledOnce();
});

it('keeps a known update visible immediately', async () => {
  mocks.service.mockResolvedValue({ phase: 'updating' });
  await mount();
  expect(notice()?.textContent).toContain('Updating Ri.');
});
