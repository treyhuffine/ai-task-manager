import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { beforeEach, expect, it, vi } from 'vitest';
import { createLocalWindow, type LocalViewId } from './local-window';
import { companionWindow } from './companion-window';
import { maintenanceWindow } from './maintenance-window';

const mocks = vi.hoisted(() => {
  const state = {
    views: [] as MockView[], deferred: false,
    loads: [] as { resolve: () => void; reject: (error: Error) => void }[],
    handlers: new Map<string, (event: unknown, action: string) => Promise<unknown>>(),
  };
  class Events {
    listeners = new Map<string, ((...args: unknown[]) => void)[]>();
    on(name: string, handler: (...args: unknown[]) => void) { this.listeners.set(name, [...this.listeners.get(name) ?? [], handler]); }
    removeListener(name: string, handler: (...args: unknown[]) => void) { this.listeners.set(name, (this.listeners.get(name) ?? []).filter(item => item !== handler)); }
    emit(name: string, ...args: unknown[]) { for (const handler of this.listeners.get(name) ?? []) handler(...args); }
  }
  class Contents extends Events {
    destroyed = false;
    mainFrame = { url: '' };
    setWindowOpenHandler = vi.fn();
    session = { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() };
    loadURL = vi.fn((url: string) => {
      this.mainFrame = { url };
      if (!state.deferred) return Promise.resolve();
      return new Promise<void>((resolve, reject) => state.loads.push({ resolve, reject }));
    });
    focus = vi.fn();
    isDestroyed() { return this.destroyed; }
    close = vi.fn(() => { this.destroyed = true; this.emit('destroyed'); });
  }
  class MockView {
    webContents = new Contents();
    setBounds = vi.fn();
    setVisible = vi.fn();
    constructor(readonly options: unknown) { state.views.push(this); }
  }
  class MockParent extends Events {
    destroyed = false;
    minimized = false;
    visible = true;
    bounds = { x: 700, y: 500, width: 1440, height: 980 };
    webContents = new Contents();
    contentView = { addChildView: vi.fn(), removeChildView: vi.fn() };
    show = vi.fn(); hide = vi.fn(); focus = vi.fn(); restore = vi.fn(); setTitle = vi.fn(); setSize = vi.fn();
    getContentBounds() { return this.bounds; }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return this.minimized; }
    isVisible() { return this.visible; }
  }
  return { state, MockParent, WebContentsView: MockView, BrowserWindow: vi.fn() };
});

vi.mock('electron', () => ({
  BrowserWindow: mocks.BrowserWindow, WebContentsView: mocks.WebContentsView,
  ipcMain: { handle: (name: string, handler: (event: unknown, action: string) => Promise<unknown>) => mocks.state.handlers.set(name, handler) },
  dialog: { showOpenDialog: vi.fn() },
}));

const page = (id: LocalViewId) => ({ id, html: `<html>${id}</html>` });
function event(view = mocks.state.views.at(-1)!) {
  return { sender: view.webContents, senderFrame: view.webContents.mainFrame } as unknown as IpcMainInvokeEvent;
}
function fixture(extra: { onShow?: () => void; onError?: (error: Error) => void } = {}) {
  const parent = new mocks.MockParent();
  const host = createLocalWindow({ window: () => parent as unknown as BrowserWindow, ...extra });
  return { parent, host };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.state.views.length = 0; mocks.state.loads.length = 0;
  mocks.state.deferred = false; mocks.state.handlers.clear();
});

it('mounts setup and recovery in the existing native window without changing its appearance or hiding its renderer', async () => {
  const onShow = vi.fn();
  const { parent, host } = fixture({ onShow });
  await host.show(page('companion'));
  const view = mocks.state.views[0];
  expect(view.options).toMatchObject({ webPreferences: {
    preload: expect.stringContaining('local-preload.cjs'), partition: expect.stringMatching(/^ri-local-/),
    sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false,
  } });
  await host.show(page('maintenance'));
  expect(mocks.state.views).toHaveLength(1);
  expect(mocks.BrowserWindow).not.toHaveBeenCalled();
  expect(parent.contentView.addChildView).toHaveBeenCalledExactlyOnceWith(view);
  expect(parent.contentView.removeChildView).not.toHaveBeenCalled();
  expect(host.get('companion')).toBeUndefined();
  expect(host.get('maintenance')).toBe(view);
  expect(host.parent('maintenance')).toBe(parent);
  expect(view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1440, height: 980 });
  for (const operation of [parent.hide, parent.show, parent.setTitle, parent.setSize, parent.restore, parent.webContents.loadURL, parent.webContents.close]) expect(operation).not.toHaveBeenCalled();
  expect(onShow).toHaveBeenCalledTimes(2);
  host.close('companion');
  expect(view.webContents.close).not.toHaveBeenCalled();
  host.close();
  expect(parent.contentView.removeChildView).toHaveBeenCalledExactlyOnceWith(view);
  expect(view.webContents.close).toHaveBeenCalledExactlyOnceWith({ waitForBeforeUnload: false });
  expect(parent.webContents.focus).toHaveBeenCalledOnce();
  expect(host.reveal()).toBe(false);
});

it('fits the content area after resize and removes native listeners on disposal', async () => {
  const { parent, host } = fixture();
  await host.show(page('companion'));
  const view = mocks.state.views[0];
  parent.bounds = { x: 120, y: 300, width: 1024, height: 768 };
  parent.emit('resize');
  expect(view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 1024, height: 768 });
  host.close();
  expect(parent.listeners.get('resize')).toEqual([]);
  expect(parent.listeners.get('closed')).toEqual([]);
  const count = view.setBounds.mock.calls.length;
  parent.emit('resize');
  expect(view.setBounds).toHaveBeenCalledTimes(count);
});

it('authorizes only the active action domain, exact sender, main frame and per-visit URL', async () => {
  const { parent, host } = fixture();
  await host.show(page('companion'));
  const prior = event();
  expect(host.owns('companion', prior)).toBe(true);
  expect(host.owns('maintenance', prior)).toBe(false);
  expect(host.owns('companion', { ...prior, sender: parent.webContents } as unknown as IpcMainInvokeEvent)).toBe(false);
  expect(host.owns('companion', { ...prior, senderFrame: { url: prior.senderFrame!.url } } as IpcMainInvokeEvent)).toBe(false);
  await host.show(page('maintenance'));
  expect(host.owns('maintenance', prior)).toBe(false);
  expect(host.owns('companion', event())).toBe(false);
  expect(host.owns('maintenance', event())).toBe(true);
  const firstMaintenance = event();
  await host.show(page('maintenance'));
  expect(host.owns('maintenance', firstMaintenance)).toBe(false);
  mocks.state.views[0].webContents.mainFrame.url = 'https://home.example/';
  expect(host.owns('maintenance', event())).toBe(false);
});

it('denies navigation, redirects, popups and permission requests', async () => {
  const { host } = fixture();
  await host.show(page('companion'));
  const contents = mocks.state.views[0].webContents;
  expect(contents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' });
  for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
    const preventDefault = vi.fn(); contents.emit(name, { preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
  }
  const granted = vi.fn();
  contents.session.setPermissionRequestHandler.mock.calls[0][0]({}, 'notifications', granted);
  expect(granted).toHaveBeenCalledWith(false);
  expect(contents.session.setPermissionCheckHandler.mock.calls[0][0]()).toBe(false);
});

it('does not attach an unfinished first load, and never reveals a superseded page', async () => {
  mocks.state.deferred = true;
  const onShow = vi.fn();
  const { host, parent } = fixture({ onShow });
  const first = host.show(page('companion'));
  const oldEvent = event();
  const next = host.show(page('maintenance'));
  expect(host.owns('companion', oldEvent)).toBe(false);
  expect(host.hasActive()).toBe(true);
  expect(host.reveal()).toBe(true);
  expect(parent.contentView.addChildView).not.toHaveBeenCalled();
  mocks.state.loads[1].resolve(); await next;
  mocks.state.loads[0].resolve(); await first;
  expect(parent.contentView.addChildView).toHaveBeenCalledOnce();
  expect(onShow).toHaveBeenCalledOnce();
  expect(host.get('maintenance')).toBe(mocks.state.views[0]);
});

it('keeps the attached local surface during page replacement without authorizing the old page', async () => {
  const { host, parent } = fixture();
  await host.show(page('companion'));
  const view = mocks.state.views[0];
  const oldEvent = event();
  mocks.state.deferred = true;
  const replacement = host.show(page('maintenance'));
  expect(parent.contentView.removeChildView).not.toHaveBeenCalled();
  expect(view.setVisible).toHaveBeenLastCalledWith(true);
  expect(host.owns('companion', oldEvent)).toBe(false);
  mocks.state.loads[0].resolve(); await replacement;
  expect(mocks.state.views).toHaveLength(1);
});

it('remembers a hide during loading and focuses only a visible, restored parent', async () => {
  mocks.state.deferred = true;
  const onShow = vi.fn();
  const { host, parent } = fixture({ onShow });
  const opening = host.show(page('companion'));
  expect(host.isPresented()).toBe(true);
  expect(host.hide()).toBe(true);
  expect(host.isPresented()).toBe(false);
  mocks.state.loads[0].resolve(); await opening;
  const contents = mocks.state.views[0].webContents;
  expect(onShow).not.toHaveBeenCalled();
  expect(contents.focus).not.toHaveBeenCalled();
  parent.visible = false;
  host.reveal();
  expect(host.isPresented()).toBe(false);
  expect(host.focus()).toBe(false);
  parent.visible = true; parent.minimized = true;
  expect(host.focus()).toBe(false);
  parent.minimized = false;
  expect(host.focus()).toBe(true);
  expect(host.isPresented()).toBe(true);
  host.close();
  expect(host.hide()).toBe(false);
  expect(host.isPresented()).toBe(false);
});

it('absorbs stale load errors, clears failed ownership, and cannot reopen a closed pending view', async () => {
  mocks.state.deferred = true;
  const onShow = vi.fn();
  const { host, parent } = fixture({ onShow });
  const first = host.show(page('companion'));
  const next = host.show(page('maintenance'));
  mocks.state.loads[0].reject(new Error('ERR_ABORTED')); await first;
  const rejected = expect(next).rejects.toThrow('current failed');
  mocks.state.loads[1].reject(new Error('current failed')); await rejected;
  expect(host.hasActive()).toBe(false);
  expect(host.reveal()).toBe(false);
  const retry = host.show(page('maintenance'));
  host.close(); mocks.state.loads[2].resolve(); await retry;
  expect(onShow).not.toHaveBeenCalled();
  expect(parent.contentView.addChildView).not.toHaveBeenCalled();
  expect(parent.listeners.get('resize')).toEqual([]);
});

it('releases the child when the native parent closes, including during navigation', async () => {
  mocks.state.deferred = true;
  const onError = vi.fn();
  const { host, parent } = fixture({ onError });
  const pending = host.show(page('companion'));
  parent.destroyed = true; parent.emit('closed');
  expect(mocks.state.views[0].webContents.close).toHaveBeenCalledOnce();
  mocks.state.loads[0].resolve(); await pending;
  expect(host.hasActive()).toBe(false);
  expect(parent.listeners.get('resize')).toEqual([]);
  expect(onError).not.toHaveBeenCalled();
});

it('reports renderer failure once, releases listeners, and allows a fresh retry', async () => {
  const onError = vi.fn();
  const { host, parent } = fixture({ onError });
  await host.show(page('companion'));
  mocks.state.views[0].webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  expect(host.hasActive()).toBe(false);
  expect(parent.contentView.removeChildView).toHaveBeenCalledOnce();
  expect(parent.listeners.get('resize')).toEqual([]);
  expect(onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: expect.stringContaining('crashed') }));
  await host.show(page('companion'));
  expect(mocks.state.views).toHaveLength(2);
  expect(mocks.state.views[0].options).not.toEqual(mocks.state.views[1].options);
});

it('does not reveal after onShow closes or replaces the active page', async () => {
  const { host } = fixture({ onShow: () => host.close() });
  await host.show(page('companion'));
  expect(mocks.state.views[0].setVisible).not.toHaveBeenCalledWith(true);
});

it('never creates a fallback native window when its parent is absent or destroyed', async () => {
  const parent = new mocks.MockParent(); parent.destroyed = true;
  for (const target of [undefined, parent]) {
    const host = createLocalWindow({ window: () => target as unknown as BrowserWindow | undefined });
    await expect(host.show(page('companion'))).rejects.toThrow('application window is unavailable');
  }
  expect(mocks.state.views).toHaveLength(0);
  expect(mocks.BrowserWindow).not.toHaveBeenCalled();
});

it('shares the host between adapters without sharing their native authorization', async () => {
  const { host } = fixture();
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
  await maintenance.show(); companion.close();
  expect(host.get('maintenance')).toBeDefined();
  await expect(companionCall(event(), 'create-home')).rejects.toThrow('Untrusted');
  await maintenanceCall(event(), 'back');
  expect(back).toHaveBeenCalledOnce();
  await expect(maintenanceCall(event(), 'retry')).rejects.toThrow('Untrusted');
  await companionCall(event(), 'status');
  expect(action).toHaveBeenCalledWith('status', undefined);
  expect(mocks.state.views).toHaveLength(1);
});

it('preserves the current companion form on repeated open and navigates when the requested view changes', async () => {
  const { host } = fixture();
  const companion = companionWindow(vi.fn(), host);
  await companion.show({ view: 'connect' });
  const contents = mocks.state.views[0].webContents;
  await companion.show({ view: 'connect' });
  expect(contents.loadURL).toHaveBeenCalledOnce();
  await companion.show({ view: 'settings' });
  expect(contents.loadURL).toHaveBeenCalledTimes(2);
  expect(mocks.state.views).toHaveLength(1);
});
