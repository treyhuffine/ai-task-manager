import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ expose: vi.fn(), on: vi.fn(), remove: vi.fn(), send: vi.fn(), sendSync: vi.fn(() => 'local') }));
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: mocks.expose }, ipcRenderer: { on: mocks.on, removeListener: mocks.remove, send: mocks.send, sendSync: mocks.sendSync } }));
afterEach(() => vi.unstubAllGlobals());

it('passes no IPC event or sender to renderer resume callbacks and removes its exact listener', async () => {
  vi.stubGlobal('process', { ...process, isMainFrame: true });
  await import('./preload');
  const bridge = mocks.expose.mock.calls[0][1] as { onResume(callback: () => void): () => void };
  const callback = vi.fn();
  const remove = bridge.onResume(callback);
  const listener = mocks.on.mock.calls[0][1];
  listener({ sender: { invoke: vi.fn() } }, 'unexpected payload');
  expect(callback).toHaveBeenCalledExactlyOnceWith();
  remove();
  expect(mocks.remove).toHaveBeenCalledWith('desktop:resume', listener);
});

it('background readiness exposes only a boolean response and removes its exact listener', async () => {
  vi.stubGlobal('process', { ...process, isMainFrame: true });
  await import('./preload');
  const bridge = mocks.expose.mock.calls[0][1] as { onPrepareBackground(callback: () => boolean): () => void };
  const callback = vi.fn(() => true);
  const remove = bridge.onPrepareBackground(callback);
  const listener = mocks.on.mock.calls.find(call => call[0] === 'desktop:prepare-background')![1];
  listener({ sender: { invoke: vi.fn() } }, 'background-nonce');
  expect(callback).toHaveBeenCalledExactlyOnceWith();
  expect(mocks.send).toHaveBeenLastCalledWith('desktop:background-ready', { nonce: 'background-nonce', ok: true });
  callback.mockReturnValue(false); listener({}, 'blocked');
  expect(mocks.send).toHaveBeenLastCalledWith('desktop:background-ready', { nonce: 'blocked', ok: false });
  callback.mockImplementation(() => { throw new Error('Unready'); }); listener({}, 'error');
  expect(mocks.send).toHaveBeenLastCalledWith('desktop:background-ready', { nonce: 'error', ok: false });
  remove(); expect(mocks.remove).toHaveBeenLastCalledWith('desktop:prepare-background', listener);
});

it('capture registers its listener before announcing readiness and never exposes the native event', async () => {
  vi.stubGlobal('process', { ...process, isMainFrame: true });
  await import('./preload');
  const bridge = mocks.expose.mock.calls[0][1] as { onQuickCapture(callback: () => void): () => void };
  const callback = vi.fn(); const remove = bridge.onQuickCapture(callback);
  const index = mocks.on.mock.calls.findIndex(call => call[0] === 'desktop:quick-capture');
  const listener = mocks.on.mock.calls[index][1];
  const ready = mocks.send.mock.calls.findIndex(call => call[0] === 'desktop:capture-ready');
  expect(mocks.on.mock.invocationCallOrder[index]).toBeLessThan(mocks.send.mock.invocationCallOrder[ready]);
  listener({ sender: { invoke: vi.fn() } }, 'untrusted payload');
  expect(callback).toHaveBeenCalledExactlyOnceWith();
  remove(); expect(mocks.remove).toHaveBeenLastCalledWith('desktop:quick-capture', listener);
});


it('remote Home viewers get save/capture hooks without native settings or notification authority', async () => {
  vi.resetModules(); mocks.expose.mockClear(); mocks.sendSync.mockReturnValue('viewer');
  vi.stubGlobal('process', { ...process, isMainFrame: true });
  await import('./preload');
  const bridge = mocks.expose.mock.calls[0][1];
  expect(bridge.settings).toBeUndefined();
  expect(bridge.notifications).toBeUndefined();
  expect(bridge.onPrepareClose).toBeTypeOf('function');
  expect(bridge.onQuickCapture).toBeTypeOf('function');
  expect(bridge.connection).toBeTypeOf('function');
  expect(bridge.onConnectionChange).toBeTypeOf('function');
  mocks.sendSync.mockReturnValue('local');
});

it('connection updates expose only presentation data and remove their exact listener', async () => {
  vi.stubGlobal('process', { ...process, isMainFrame: true });
  await import('./preload');
  const bridge = mocks.expose.mock.calls[0][1];
  const callback = vi.fn();
  const off = bridge.onConnectionChange(callback);
  const listener = mocks.on.mock.calls.find(call => call[0] === 'desktop:connection')![1];
  const state = { phase: 'failed', issue: null, showNotice: false };
  listener({ sender: { invoke: vi.fn() } }, state);
  expect(callback).toHaveBeenCalledExactlyOnceWith(state);
  off();
  expect(mocks.remove).toHaveBeenLastCalledWith('desktop:connection', listener);
});
