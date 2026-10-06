import { BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export type LocalViewId = 'companion' | 'maintenance';
export interface LocalWindowView {
  id: LocalViewId;
  html: string;
  title: string;
  width: number;
  height: number;
}

/** One local control surface. The active document, not possession of its
 * preload, determines which native actions are available. It never shares the
 * authenticated Home viewer's session or renders content from a Home. */
export function createLocalWindow(callbacks: { onShow?: () => void; onUserClose?: () => void } = {}) {
  let window: BrowserWindow | undefined;
  let active: LocalViewId | undefined;
  let trustedUrl = '';
  let revision = 0;
  let loaded = false;
  let foreground = false;

  const get = (id: LocalViewId) => active === id && window && !window.isDestroyed() ? window : undefined;
  const current = (target: BrowserWindow, version: number) => window === target && revision === version && !target.isDestroyed();
  const display = () => {
    if (!window || window.isDestroyed() || !active) return false;
    // A pending local page still owns presentation. Never reveal its previous
    // document or let a dock activation bring back the main loading window.
    if (!loaded || !foreground) return true;
    const target = window;
    const version = revision;
    callbacks.onShow?.();
    if (current(target, version)) {
      if (target.isMinimized()) target.restore();
      target.show(); target.focus();
    }
    return true;
  };

  return {
    get,
    reveal() { foreground = true; return display(); },
    hide() {
      if (!window || window.isDestroyed() || !active) return false;
      foreground = false; window.hide(); return true;
    },
    isPresented() {
      return !!window && !window.isDestroyed() && !!active && foreground &&
        (!loaded || (window.isVisible() && !window.isMinimized()));
    },
    owns(id: LocalViewId, event: IpcMainInvokeEvent) {
      const target = get(id);
      return !!target && event.sender === target.webContents && event.senderFrame === target.webContents.mainFrame && event.senderFrame.url === trustedUrl;
    },
    async show(view: LocalWindowView) {
      const version = ++revision;
      active = view.id;
      loaded = false;
      foreground = true;
      // Even equal HTML gets a new URL so an old document cannot call into a
      // later visit to the same action domain while its navigation is pending.
      trustedUrl = `data:text/html;charset=utf-8,${encodeURIComponent(view.html)}#${randomBytes(16).toString('hex')}`;
      if (!window || window.isDestroyed()) {
        const target = new BrowserWindow({ width: view.width, height: view.height, minWidth: 520, minHeight: 500,
          show: false, title: view.title, backgroundColor: '#181a18',
          webPreferences: { preload: path.join(__dirname, 'local-preload.cjs'), partition: `ri-local-${randomBytes(16).toString('hex')}`,
            nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false } });
        window = target;
        target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        target.webContents.on('will-navigate', event => event.preventDefault());
        target.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        target.webContents.session.setPermissionCheckHandler(() => false);
        target.on('closed', () => {
          // Programmatic close clears ownership before destroy(), suppressing
          // this callback and invalidating any unfinished navigation.
          if (window !== target) return;
          window = undefined; active = undefined; trustedUrl = ''; loaded = false; foreground = false; revision++;
          callbacks.onUserClose?.();
        });
      } else {
        window.hide();
        window.setTitle(view.title);
        window.setSize(view.width, view.height);
      }
      const target = window;
      try { await target.loadURL(trustedUrl); }
      catch (error) {
        if (!current(target, version)) return;
        // A failed page cannot keep ownership and turn a later retry into a
        // no-op reveal of a document that never finished loading.
        active = undefined; trustedUrl = ''; loaded = false; foreground = false; revision++;
        throw error;
      }
      if (!current(target, version)) return;
      loaded = true;
      display();
    },
    close(id?: LocalViewId) {
      if (id !== undefined && active !== id) return;
      const target = window;
      window = undefined; active = undefined; trustedUrl = ''; loaded = false; foreground = false; revision++;
      if (target && !target.isDestroyed()) target.destroy();
    },
  };
}

export type LocalWindow = ReturnType<typeof createLocalWindow>;
