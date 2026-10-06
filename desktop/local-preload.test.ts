import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ expose: vi.fn(), on: vi.fn(), remove: vi.fn(), invoke: vi.fn() }));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.expose },
  ipcRenderer: { on: mocks.on, removeListener: mocks.remove, invoke: mocks.invoke },
}));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
afterEach(() => vi.unstubAllGlobals());

it('delivers only valid theme values, strips the native event and unsubscribes its exact listener', async () => {
  vi.stubGlobal('process', { ...process, isMainFrame: true });
  await import('./local-preload');
  const bridge = mocks.expose.mock.calls.find(([name]) => name === 'riLocal')![1] as {
    onTheme(callback: (theme: 'light' | 'dark') => void): () => void;
  };
  expect(Object.isFrozen(bridge)).toBe(true);
  expect(Object.keys(bridge)).toEqual(['onTheme']);
  const callback = vi.fn();
  const unsubscribe = bridge.onTheme(callback);
  const [channel, listener] = mocks.on.mock.calls[0];
  expect(channel).toBe('desktop:theme');
  const nativeEvent = { sender: { invoke: vi.fn() }, reply: vi.fn() };
  for (const value of [undefined, null, true, 1, {}, { theme: 'dark' }, ['light'], 'system', 'LIGHT', 'dark<script>']) {
    listener(nativeEvent, value);
  }
  expect(callback).not.toHaveBeenCalled();
  listener(nativeEvent, 'light', { secret: 'extra payload' });
  listener(nativeEvent, 'dark', nativeEvent);
  expect(callback.mock.calls).toEqual([['light'], ['dark']]);
  expect(mocks.invoke).not.toHaveBeenCalled();
  unsubscribe();
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('desktop:theme', listener);
});

it('keeps independent subscribers separate and does not leak one into another unsubscribe', async () => {
  vi.stubGlobal('process', { ...process, isMainFrame: true });
  await import('./local-preload');
  const bridge = mocks.expose.mock.calls.find(([name]) => name === 'riLocal')![1];
  const first = vi.fn(); const second = vi.fn();
  const stopFirst = bridge.onTheme(first); const stopSecond = bridge.onTheme(second);
  const firstListener = mocks.on.mock.calls[0][1]; const secondListener = mocks.on.mock.calls[1][1];
  expect(firstListener).not.toBe(secondListener);
  stopFirst(); expect(mocks.remove).toHaveBeenLastCalledWith('desktop:theme', firstListener);
  secondListener({}, 'dark'); expect(second).toHaveBeenCalledExactlyOnceWith('dark'); expect(first).not.toHaveBeenCalled();
  stopSecond(); expect(mocks.remove).toHaveBeenLastCalledWith('desktop:theme', secondListener);
});

it('exposes no local bridges in subframes', async () => {
  vi.stubGlobal('process', { ...process, isMainFrame: false });
  await import('./local-preload');
  expect(mocks.expose).not.toHaveBeenCalled();
  expect(mocks.on).not.toHaveBeenCalled();
});
