import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ expose: vi.fn(), on: vi.fn(), remove: vi.fn(), send: vi.fn(), invoke: vi.fn() }));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.expose },
  ipcRenderer: { on: mocks.on, removeListener: mocks.remove, send: mocks.send, invoke: mocks.invoke },
}));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
afterEach(() => vi.unstubAllGlobals());

interface FindBridge {
  query(text: unknown): void; next(): void; previous(): void; close(): void;
  onOpen(callback: (query: string) => void): () => void;
  onResult(callback: (label: string) => void): () => void;
}
async function load() {
  vi.stubGlobal('process', { ...process, isMainFrame: true });
  await import('./find-preload');
  const bridge = (name: string) => mocks.expose.mock.calls.find(([exposed]) => exposed === name)?.[1];
  return { find: bridge('riFind') as FindBridge, local: bridge('riLocal') };
}

it('exposes only the find actions and the theme, frozen', async () => {
  const { find, local } = await load();
  expect(mocks.expose.mock.calls.map(([name]) => name)).toEqual(['riLocal', 'riFind']);
  expect(Object.isFrozen(find)).toBe(true);
  expect(Object.isFrozen(local)).toBe(true);
  expect(Object.keys(find)).toEqual(['query', 'next', 'previous', 'close', 'onOpen', 'onResult']);
  expect(Object.keys(local)).toEqual(['onTheme']);
});

it('sends each action on the one find channel, with text as a string', async () => {
  const { find } = await load();
  find.query('deck'); find.query(42); find.next(); find.previous(); find.close();
  expect(mocks.send.mock.calls).toEqual([
    ['desktop:find', 'query', 'deck'], ['desktop:find', 'query', '42'],
    ['desktop:find', 'next'], ['desktop:find', 'previous'], ['desktop:find', 'close'],
  ]);
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it('passes only strings to the page, never the native event, and unsubscribes exactly', async () => {
  const { find } = await load();
  for (const [channel, subscribe] of [['desktop:find-open', find.onOpen], ['desktop:find-result', find.onResult]] as const) {
    mocks.on.mockClear(); mocks.remove.mockClear();
    const callback = vi.fn();
    const unsubscribe = subscribe(callback);
    const [registered, listener] = mocks.on.mock.calls[0];
    expect(registered).toBe(channel);
    const nativeEvent = { sender: { send: vi.fn() }, reply: vi.fn() };
    for (const value of [undefined, null, 1, {}, ['x']]) listener(nativeEvent, value);
    listener(nativeEvent, 'deck', nativeEvent);
    listener(nativeEvent, '');
    expect(callback.mock.calls).toEqual([['deck'], ['']]);
    unsubscribe();
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(channel, listener);
  }
});

it('exposes nothing in subframes', async () => {
  vi.stubGlobal('process', { ...process, isMainFrame: false });
  await import('./find-preload');
  expect(mocks.expose).not.toHaveBeenCalled();
});
