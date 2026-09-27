import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ expose: vi.fn(), on: vi.fn(), remove: vi.fn(), send: vi.fn() }));
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: mocks.expose }, ipcRenderer: { on: mocks.on, removeListener: mocks.remove, send: mocks.send } }));
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
