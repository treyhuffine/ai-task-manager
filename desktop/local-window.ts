import { WebContentsView, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export type LocalViewId = 'companion' | 'maintenance' | 'loading';
export interface LocalWindowView { id: LocalViewId; html: string }

interface LocalSurface {
  view: WebContentsView;
  parent: BrowserWindow;
  id: LocalViewId;
  url: string;
  loaded: boolean;
  foreground: boolean;
  attached: boolean;
  resize(): void;
  closed(): void;
}

/** A privileged local renderer inside the existing native window. The Home
 * renderer stays alive underneath, without sharing sessions or native access.
 * Native visibility, title and geometry remain the main window's responsibility. */
export function createLocalWindow(callbacks: {
  window(): BrowserWindow | undefined;
  onShow?: () => void;
  onError?: (error: Error) => void;
}) {
  let surface: LocalSurface | undefined;
  let revision = 0;
  const alive = (target: LocalSurface) => !target.parent.isDestroyed() && !target.view.webContents.isDestroyed();
  const current = (target: LocalSurface, version = revision) => surface === target && revision === version && alive(target);
  const getSurface = (id?: LocalViewId) => surface && alive(surface) && (id === undefined || surface.id === id) ? surface : undefined;

  function dispose(target: LocalSurface, restoreFocus: boolean) {
    if (surface === target) { surface = undefined; revision++; }
    target.parent.removeListener('resize', target.resize);
    target.parent.removeListener('closed', target.closed);
    if (!target.parent.isDestroyed() && target.attached) target.parent.contentView.removeChildView(target.view);
    if (!target.view.webContents.isDestroyed()) target.view.webContents.close({ waitForBeforeUnload: false });
    if (restoreFocus && !target.parent.isDestroyed() && target.parent.isVisible() && !target.parent.isMinimized() && !target.parent.webContents.isDestroyed()) {
      target.parent.webContents.focus();
    }
  }

  function display() {
    const target = getSurface();
    if (!target) return false;
    // A pending page still owns startup presentation. A dock activation must
    // not dismiss it or authorize the document from its previous navigation.
    if (!target.loaded || !target.foreground) return true;
    const version = revision;
    callbacks.onShow?.();
    if (current(target, version)) {
      target.view.setVisible(true);
      if (target.parent.isVisible() && !target.parent.isMinimized()) target.view.webContents.focus();
    }
    return true;
  }

  return {
    get(id: LocalViewId) { return getSurface(id)?.view; },
    parent(id: LocalViewId) { return getSurface(id)?.parent; },
    hasActive() { return !!getSurface(); },
    reveal() { if (surface) surface.foreground = true; return display(); },
    focus() {
      const target = getSurface();
      if (!target?.loaded || !target.foreground || !target.parent.isVisible() || target.parent.isMinimized()) return false;
      target.view.webContents.focus();
      return true;
    },
    hide() {
      const target = getSurface();
      if (!target) return false;
      target.foreground = false;
      target.view.setVisible(false);
      return true;
    },
    isPresented() {
      const target = getSurface();
      return !!target && target.foreground && target.parent.isVisible() && !target.parent.isMinimized();
    },
    owns(id: LocalViewId, event: IpcMainInvokeEvent) {
      const target = getSurface(id);
      return !!target && event.sender === target.view.webContents && event.senderFrame === target.view.webContents.mainFrame && event.senderFrame.url === target.url;
    },
    async show(page: LocalWindowView) {
      const parent = callbacks.window();
      if (!parent || parent.isDestroyed()) throw new Error('Ri application window is unavailable.');
      if (surface && (!alive(surface) || surface.parent !== parent)) dispose(surface, false);
      if (!surface) {
        const view = new WebContentsView({ webPreferences: {
          preload: path.join(__dirname, 'local-preload.cjs'), partition: `ri-local-${randomBytes(16).toString('hex')}`,
          nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false,
        } });
        view.setVisible(false);
        const target: LocalSurface = {
          view, parent, id: page.id, url: '', loaded: false, foreground: true, attached: false,
          resize() {
            if (!alive(target)) return;
            const { width, height } = parent.getContentBounds();
            view.setBounds({ x: 0, y: 0, width, height });
          },
          closed() { if (surface === target) dispose(target, false); },
        };
        surface = target;
        parent.on('resize', target.resize);
        parent.on('closed', target.closed);
        view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        view.webContents.on('will-navigate', event => event.preventDefault());
        view.webContents.on('will-frame-navigate', event => event.preventDefault());
        view.webContents.on('will-redirect', event => event.preventDefault());
        view.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        view.webContents.session.setPermissionCheckHandler(() => false);
        view.webContents.on('render-process-gone', (_event, details) => {
          if (surface !== target) return;
          dispose(target, true);
          callbacks.onError?.(new Error(`Ri desktop settings stopped unexpectedly (${details.reason}). Open Desktop Settings to try again.`));
        });
        view.webContents.on('destroyed', () => {
          if (surface !== target) return;
          dispose(target, true);
          callbacks.onError?.(new Error('Ri desktop settings closed unexpectedly. Open Desktop Settings to try again.'));
        });
      }
      const target = surface;
      const version = ++revision;
      target.id = page.id;
      target.loaded = false;
      target.foreground = true;
      // An unpredictable URL binds each visit to its exact document, including
      // repeated visits to the same action domain while navigation is pending.
      target.url = `data:text/html;charset=utf-8,${encodeURIComponent(page.html)}#${randomBytes(16).toString('hex')}`;
      try { await target.view.webContents.loadURL(target.url); }
      catch (error) {
        if (!current(target, version)) return;
        dispose(target, true);
        throw error;
      }
      if (!current(target, version)) return;
      target.loaded = true;
      target.resize();
      if (!target.attached) { parent.contentView.addChildView(target.view); target.attached = true; }
      // Replacing a local page reuses its attached view. Chromium retains the
      // prior page until navigation commits, avoiding a native window handoff.
      display();
    },
    close(id?: LocalViewId) {
      if (surface && (id === undefined || surface.id === id)) dispose(surface, true);
    },
  };
}

export type LocalWindow = ReturnType<typeof createLocalWindow>;
