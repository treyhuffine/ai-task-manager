import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('./desktop-nav-buttons', () => ({ DesktopNavButtons: () => null }));
import { DesktopChrome } from './desktop-chrome';
import { useSharedBodyFor, type SharedBodyTarget } from '@/components/team/shared-body-editor';
import { documentSaves } from '@/lib/client/document-saves';
import { prepareVersionReload, reloadVersion } from '@/lib/client/version-reload';
import type { SharedBody } from '@/lib/team/shared-body';

let root: Root;
let qc: QueryClient;
let prepare: (() => Promise<boolean>) | undefined;
let resume: (() => void) | undefined;
let shared: ReturnType<typeof useSharedBodyFor>;
let storage: Map<string, string>;
const draftKey = 'test:shared-body';

beforeEach(() => {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  storage = new Map();
  Object.defineProperty(window, 'location', { configurable: true, value: new URL('http://localhost/space/team-fixture') });
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } });
  Object.defineProperty(window, 'riDesktop', { configurable: true, value: {
    platform: 'darwin',
    onPrepareClose: (callback: () => Promise<boolean>) => { prepare = callback; return () => { prepare = undefined; }; },
    onResume: (callback: () => void) => { resume = callback; return () => { resume = undefined; }; },
  } });
  document.documentElement.dataset.riAuthority = 'space';
  document.documentElement.dataset.riSpace = 'team-fixture';
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  root = createRoot(document.getElementById('root')!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  expect(prepare).toBeUndefined();
  expect(documentSaves.has()).toBe(false);
  qc.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(write?: SharedBodyTarget['write']) {
  const target: SharedBodyTarget = { draftKey, toEditor: body => body,
    write: write ?? (async input => ({ body: input.body, bodyRevision: input.expectedBodyRevision + 1 })) };
  function Editor() {
    const value = useSharedBodyFor({ id: 'note', body: '', bodyRevision: 1 }, target);
    useEffect(() => { shared = value; }, [value]);
    return null;
  }
  await act(async () => root.render(createElement(QueryClientProvider, { client: qc },
    createElement(DesktopChrome), createElement(Editor))));
  expect(shared.ready).toBe(true);
}

it.each(['personal', 'space', 'team'])('answers the desktop navigation handshake on a clean %s page', async authority => {
  document.documentElement.dataset.riAuthority = authority;
  await mount();
  expect(document.documentElement.dataset.riDesktop).toBe('darwin');
  expect(prepare).toBeTypeOf('function');
  await expect(prepare!()).resolves.toBe(true);
  expect(document.body.inert).toBe(true);
  resume!();
  expect(document.body.inert).toBe(false);
});

it('waits for a shared note autosave before allowing the desktop to leave', async () => {
  let release!: (body: SharedBody) => void;
  const write = vi.fn(() => new Promise<SharedBody>(resolve => { release = resolve; }));
  await mount(write);
  await act(async () => shared.edit('Newest shared text'));
  let result: boolean | undefined;
  let pending!: Promise<void>;
  await act(async () => { pending = prepare!().then(value => { result = value; }); });
  expect(write).toHaveBeenCalledWith({ body: 'Newest shared text', expectedBodyRevision: 1, attachments: [] });
  expect(result).toBeUndefined();
  expect(document.body.inert).toBe(true);
  await act(async () => { release({ body: 'Newest shared text', bodyRevision: 2 }); await pending; });
  expect(result).toBe(true);
  expect(storage.has(draftKey)).toBe(false);
});

it('keeps a failed shared save editable and blocks leaving until it succeeds', async () => {
  const write = vi.fn<SharedBodyTarget['write']>().mockRejectedValue(new Error('offline'));
  await mount(write);
  await act(async () => shared.edit('Keep this text'));
  await act(async () => { await expect(prepare!()).resolves.toBe(false); });
  expect(document.body.inert).toBe(false);
  expect(JSON.parse(storage.get(draftKey)!).body).toBe('Keep this text');
  write.mockResolvedValue({ body: 'Keep this text', bodyRevision: 2 });
  await act(async () => { await expect(prepare!()).resolves.toBe(true); });
});

it('does not bypass a shared conflict, even though its flush resolves', async () => {
  storage.set(draftKey, JSON.stringify({ body: 'Conflicting draft', baseRevision: 0 }));
  const write = vi.fn<SharedBodyTarget['write']>();
  await mount(write);
  expect(shared.status.status).toBe('conflict');
  await expect(prepare!()).resolves.toBe(false);
  expect(document.body.inert).toBe(false);
  expect(write).not.toHaveBeenCalled();
  const unload = new window.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  // Explicit version recovery can retain the conflict, but cannot silently
  // leave when the browser cannot prove that the draft reached storage.
  await expect(prepareVersionReload(() => 0, true)).resolves.toBeUndefined();
  await reloadVersion(() => 0, true, () => {
    const retained = new window.Event('beforeunload', { cancelable: true });
    window.dispatchEvent(retained);
    expect(retained.defaultPrevented).toBe(false);
  });
  await new Promise(resolve => setTimeout(resolve, 1));
  vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('storage full'); });
  await expect(prepareVersionReload(() => 0, true)).rejects.toThrow('storage full');
  await act(async () => shared.useTheirs());
  await expect(prepare!()).resolves.toBe(true);
});

it('waits for typed input requests but permits background work to continue after leaving', async () => {
  await mount();
  let acknowledge!: () => void;
  const input = qc.getMutationCache().build(qc, { meta: { carriesInput: true }, mutationFn: () => new Promise<void>(resolve => { acknowledge = resolve; }) });
  const sent = input.execute(undefined);
  await vi.waitFor(() => expect(acknowledge).toBeTypeOf('function'));
  let finished = false;
  const pending = prepare!().then(ok => { finished = ok; });
  await new Promise(resolve => setTimeout(resolve, 60));
  expect(finished).toBe(false);
  acknowledge();
  await sent;
  await pending;
  expect(finished).toBe(true);
  let finishWork!: () => void;
  const background = qc.getMutationCache().build(qc, { mutationFn: () => new Promise<void>(resolve => { finishWork = resolve; }) });
  const running = background.execute(undefined);
  await vi.waitFor(() => expect(finishWork).toBeTypeOf('function'));
  await expect(prepare!()).resolves.toBe(true);
  finishWork();
  await running;
});
