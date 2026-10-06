import type { IpcMainInvokeEvent } from 'electron';
import { beforeEach, expect, it, vi } from 'vitest';
import { createLocalWindow, type LocalViewId } from './local-window';
import { companionWindow } from './companion-window';
import { maintenanceWindow } from './maintenance-window';

const mocks = vi.hoisted(() => {
  const state = {
    windows: [] as MockWindow[], deferred: false,
    loads: [] as { resolve: () => void; reject: (error: Error) => void }[],
    handlers: new Map<string, (event: unknown, action: string) => Promise<unknown>>(),
    sequence: [] as string[],
  };
  class MockWindow {
    destroyed = false;
    minimized = false;
    visible = false;
    listeners = new Map<string, (() => void)[]>();
    webContents = {
      mainFrame: { url: '' }, setWindowOpenHandler: vi.fn(), on: vi.fn(),
      session: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() },
    };
    constructor(readonly options: unknown) { state.windows.push(this); }
    loadURL = vi.fn((url: string) => {
      this.webContents.mainFrame = { url };
      if (!state.deferred) return Promise.resolve();
      return new Promise<void>((resolve, reject) => state.loads.push({ resolve, reject }));
    });
    on(name: string, handler: () => void) { this.listeners.set(name, [...this.listeners.get(name) ?? [], handler]); }
    emit(name: string) { for (const handler of this.listeners.get(name) ?? []) handler(); }
    show = vi.fn(() => { this.visible = true; state.sequence.push('show'); });
    focus = vi.fn();
    hide = vi.fn(() => { this.visible = false; });
    setTitle = vi.fn();
    setSize = vi.fn();
    isDestroyed() { return this.destroyed; }
    isMinimized() { return this.minimized; }
    isVisible() { return this.visible; }
    restore = vi.fn(() => { this.minimized = false; });
    destroy = vi.fn(() => { this.destroyed = true; this.emit('closed'); });
  }
  return { state, BrowserWindow: MockWindow };
});

vi.mock('electron', () => ({
  BrowserWindow: mocks.BrowserWindow,
  ipcMain: { handle: (name: string, handler: (event: unknown, action: string) => Promise<unknown>) => mocks.state.handlers.set(name, handler) },
  dialog: { showOpenDialog: vi.fn() },
}));

const view = (id: LocalViewId) => ({ id, html: `<html>${id}</html>`, title: id, width: id === 'companion' ? 640 : 800, height: 820 });
function event(window = mocks.state.windows.at(-1)!) {
  return { sender: window.webContents, senderFrame: window.webContents.mainFrame } as unknown as IpcMainInvokeEvent;
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.state.windows.length = 0; mocks.state.loads.length = 0;
  mocks.state.sequence.length = 0; mocks.state.deferred = false; mocks.state.handlers.clear();
});

it('replaces setup with recovery in one isolated window and hides the viewer before showing it', async () => {
  const host = createLocalWindow({ onShow: () => { mocks.state.sequence.push('hide-viewer'); } });
  await host.show(view('companion'));
  const window = mocks.state.windows[0];
  expect(window.options).toMatchObject({ show: false, webPreferences: {
    preload: expect.stringContaining('local-preload.cjs'), partition: expect.stringMatching(/^ri-local-/),
    sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false,
  } });
  await host.show(view('maintenance'));
  expect(mocks.state.windows).toHaveLength(1);
  expect(host.get('companion')).toBeUndefined();
  expect(host.get('maintenance')).toBe(window);
  expect(window.hide).toHaveBeenCalledOnce();
  expect(window.setTitle).toHaveBeenCalledWith('maintenance');
  expect(window.setSize).toHaveBeenCalledWith(800, 820);
  expect(mocks.state.sequence).toEqual(['hide-viewer', 'show', 'hide-viewer', 'show']);
  host.close('companion');
  expect(window.destroy).not.toHaveBeenCalled();
  expect(host.reveal()).toBe(true);
  window.minimized = true;
  expect(host.reveal()).toBe(true);
  expect(window.restore).toHaveBeenCalledOnce();
  host.close();
  expect(host.reveal()).toBe(false);
});

it('authorizes only the current action domain, exact main frame and exact local URL', async () => {
  const host = createLocalWindow();
  await host.show(view('companion'));
  const prior = event();
  expect(host.owns('companion', prior)).toBe(true);
  expect(host.owns('maintenance', prior)).toBe(false);
  expect(host.owns('companion', { ...prior, sender: {} } as IpcMainInvokeEvent)).toBe(false);
  expect(host.owns('companion', { ...prior, senderFrame: { url: prior.senderFrame!.url } } as IpcMainInvokeEvent)).toBe(false);
  await host.show(view('maintenance'));
  expect(host.owns('maintenance', prior)).toBe(false);
  expect(host.owns('companion', event())).toBe(false);
  expect(host.owns('maintenance', event())).toBe(true);
  mocks.state.windows[0].webContents.mainFrame.url = 'https://home.example/';
  expect(host.owns('maintenance', event())).toBe(false);
});

it('denies navigation, popups and permission requests', async () => {
  const host = createLocalWindow();
  await host.show(view('companion'));
  const contents = mocks.state.windows[0].webContents;
  expect(contents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' });
  const preventDefault = vi.fn();
  contents.on.mock.calls.find(([name]) => name === 'will-navigate')![1]({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
  const granted = vi.fn();
  contents.session.setPermissionRequestHandler.mock.calls[0][0]({}, 'notifications', granted);
  expect(granted).toHaveBeenCalledWith(false);
  expect(contents.session.setPermissionCheckHandler.mock.calls[0][0]()).toBe(false);
});

it('notifies once on user close and never on programmatic closure', async () => {
  const onUserClose = vi.fn();
  const host = createLocalWindow({ onUserClose });
  await host.show(view('companion'));
  const first = mocks.state.windows[0];
  first.destroy(); first.emit('closed');
  expect(onUserClose).toHaveBeenCalledOnce();
  expect(host.get('companion')).toBeUndefined();
  await host.show(view('maintenance'));
  host.close();
  expect(onUserClose).toHaveBeenCalledOnce();
});

it('never reveals a superseded page when its asynchronous load finishes late', async () => {
  mocks.state.deferred = true;
  const onShow = vi.fn();
  const host = createLocalWindow({ onShow });
  const first = host.show(view('companion'));
  const window = mocks.state.windows[0];
  const oldEvent = event();
  const next = host.show(view('maintenance'));
  expect(host.owns('companion', oldEvent)).toBe(false);
  expect(host.reveal()).toBe(true);
  expect(window.show).not.toHaveBeenCalled();
  mocks.state.loads[1].resolve(); await next;
  mocks.state.loads[0].resolve(); await first;
  expect(window.show).toHaveBeenCalledOnce();
  expect(onShow).toHaveBeenCalledOnce();
  expect(host.get('maintenance')).toBe(window);
});

it('remembers foreground intent while loading and respects a hide before the load finishes', async () => {
  mocks.state.deferred = true;
  const host = createLocalWindow();
  const opening = host.show(view('companion'));
  expect(host.isPresented()).toBe(true);
  expect(host.hide()).toBe(true);
  expect(host.isPresented()).toBe(false);
  mocks.state.loads[0].resolve(); await opening;
  const window = mocks.state.windows[0];
  expect(window.show).not.toHaveBeenCalled();
  expect(host.reveal()).toBe(true);
  expect(host.isPresented()).toBe(true);
  window.minimized = true;
  expect(host.isPresented()).toBe(false);
  host.close();
  expect(host.hide()).toBe(false);
  expect(host.isPresented()).toBe(false);
});

it('absorbs only stale navigation errors and cannot reopen a closed pending page', async () => {
  mocks.state.deferred = true;
  const onShow = vi.fn();
  const onUserClose = vi.fn();
  const host = createLocalWindow({ onShow, onUserClose });
  const first = host.show(view('companion'));
  const next = host.show(view('maintenance'));
  mocks.state.loads[0].reject(new Error('ERR_ABORTED')); await first;
  const rejected = expect(next).rejects.toThrow('current failed');
  mocks.state.loads[1].reject(new Error('current failed')); await rejected;
  expect(host.get('maintenance')).toBeUndefined();
  expect(host.reveal()).toBe(false);
  const retry = host.show(view('maintenance'));
  host.close(); mocks.state.loads[2].resolve(); await retry;
  expect(onShow).not.toHaveBeenCalled(); expect(onUserClose).not.toHaveBeenCalled();
  expect(host.reveal()).toBe(false);
});

it('does not show after onShow closes or replaces the selected page', async () => {
  const host = createLocalWindow({ onShow: () => host.close() });
  await host.show(view('companion'));
  expect(mocks.state.windows[0].show).not.toHaveBeenCalled();
});

it('shares the host between adapters without sharing their native authorization', async () => {
  const host = createLocalWindow();
  const action = vi.fn().mockResolvedValue({ role: 'first-run' });
  const companion = companionWindow(action, host);
  const status = vi.fn().mockResolvedValue({ phase: 'stopped' });
  const back = vi.fn(async () => companion.show());
  const maintenance = maintenanceWindow({ status, back, retry: vi.fn(), recover: vi.fn(), logs: vi.fn(), copy: vi.fn(),
    inspect: vi.fn(), use: vi.fn(), default: vi.fn() }, host);
  const companionCall = mocks.state.handlers.get('desktop:companion')!;
  const maintenanceCall = mocks.state.handlers.get('desktop:maintenance')!;
  await companion.show();
  await expect(maintenanceCall(event(), 'recover')).rejects.toThrow('Untrusted');
  await maintenance.show();
  companion.close(); // A delayed viewer commit must not destroy recovery by id.
  expect(host.get('maintenance')).toBeDefined();
  await expect(companionCall(event(), 'create-home')).rejects.toThrow('Untrusted');
  await maintenanceCall(event(), 'back');
  expect(back).toHaveBeenCalledOnce();
  await expect(maintenanceCall(event(), 'retry')).rejects.toThrow('Untrusted');
  await companionCall(event(), 'status');
  expect(action).toHaveBeenCalledWith('status', undefined);
  expect(mocks.state.windows).toHaveLength(1);
});

it('preserves the current companion form on repeated open and navigates when the view changes', async () => {
  const companion = companionWindow(vi.fn());
  await companion.show({ view: 'connect' });
  const window = mocks.state.windows[0];
  await companion.show({ view: 'connect' });
  expect(window.loadURL).toHaveBeenCalledOnce();
  await companion.show({ view: 'settings' });
  expect(window.loadURL).toHaveBeenCalledTimes(2);
  expect(mocks.state.windows).toHaveLength(1);
});
