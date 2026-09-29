import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { installShellUpdate, stageMacUpdate } from './shell-install';

afterEach(() => vi.useRealTimers());

it('waits for native staging without arming an automatic quit', async () => {
  const native = Object.assign(new EventEmitter(), { checkForUpdates: vi.fn() });
  const done = vi.fn();
  const pending = stageMacUpdate(native).then(done);
  expect(native.checkForUpdates).toHaveBeenCalledOnce();
  await Promise.resolve();
  expect(done).not.toHaveBeenCalled();
  native.emit('update-downloaded');
  await pending;
  expect(done).toHaveBeenCalledOnce();
  expect(native.listenerCount('update-downloaded')).toBe(0);
  expect(native.listenerCount('error')).toBe(0);
});

it('leaves no pending quit when native staging fails or completes late', async () => {
  const native = Object.assign(new EventEmitter(), { checkForUpdates: vi.fn() });
  const pending = stageMacUpdate(native);
  native.emit('error', new Error('The app signature is invalid'));
  await expect(pending).rejects.toThrow('signature');
  expect(native.listenerCount('update-downloaded')).toBe(0);
  expect(() => native.emit('update-downloaded')).not.toThrow();
});

it('bounds native staging without abandoning listeners', async () => {
  vi.useFakeTimers();
  const native = Object.assign(new EventEmitter(), { checkForUpdates: vi.fn() });
  const pending = expect(stageMacUpdate(native, 100)).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(100);
  await pending;
  expect(native.listenerCount('update-downloaded')).toBe(0);
  expect(native.listenerCount('error')).toBe(0);
});

it('keeps lifecycle ownership until the native installer starts closing windows', async () => {
  const native = new EventEmitter();
  const updater = Object.assign(new EventEmitter(), { quitAndInstall: vi.fn() });
  const commit = vi.fn();
  const done = vi.fn();
  const pending = installShellUpdate(updater, native, commit).then(done);
  await Promise.resolve();
  expect(updater.quitAndInstall).toHaveBeenCalledOnce();
  expect(commit).not.toHaveBeenCalled();
  expect(done).not.toHaveBeenCalled();
  native.emit('before-quit-for-update');
  expect(commit).toHaveBeenCalledOnce();
  await pending;
  expect(done).toHaveBeenCalledOnce();
  expect(updater.listenerCount('error')).toBe(0);
  expect(native.listenerCount('before-quit-for-update')).toBe(0);
});

it('retains normal quit and connection behavior after an installer error', async () => {
  const native = new EventEmitter();
  const updater = Object.assign(new EventEmitter(), { quitAndInstall: vi.fn() });
  const commit = vi.fn();
  const pending = installShellUpdate(updater, native, commit);
  updater.emit('error', new Error('Install destination is not writable'));
  await expect(pending).rejects.toThrow('not writable');
  expect(commit).not.toHaveBeenCalled();
  expect(native.listenerCount('before-quit-for-update')).toBe(0);
});
