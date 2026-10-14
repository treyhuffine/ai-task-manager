/**
 * Find in page for the desktop app (docs/desktop.md, "Find in page").
 *
 * A browser's find bar is part of the browser, so a page in Electron has none.
 * This one lives in a small local view of its own, floating over the page it
 * searches. Keeping it out of that page means the search box never counts as a
 * match, typing never fights the page for focus, and a team page with no bridge
 * gets it all the same. The bar gets the same isolation as the other local views:
 * a sandbox, a session of its own, no navigation and no permissions.
 */

import { ipcMain, WebContentsView, type BaseWindow, type BrowserWindow, type IpcMainEvent, type MenuItemConstructorOptions, type WebContents } from 'electron';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { findBarPage } from './find-page';
import type { DesktopTheme } from './appearance';
import type { LocalPageStyleOptions } from './local-page-style';

/** The bar's view: a 40px card plus room for its shadow, under the app's 40px
 * title bar at the right, where a browser puts its find bar. */
export const FIND_BAR = { width: 380, height: 56, top: 40, right: 8 } as const;
const MAX_QUERY = 1000;

export function findBarBounds(content: { width: number; height: number }) {
  const width = Math.max(0, Math.min(FIND_BAR.width, content.width));
  return { x: Math.max(0, content.width - width - FIND_BAR.right), y: FIND_BAR.top, width, height: FIND_BAR.height };
}

/** Where a search stands, as the bar shows it. */
export function matchLabel(active: number, matches: number) {
  if (!Number.isFinite(matches) || matches <= 0) return 'No results';
  if (!Number.isFinite(active) || active <= 0) return matches === 1 ? '1 match' : `${matches} matches`;
  return `${active} of ${matches}`;
}

interface Bar {
  parent: BrowserWindow;
  target: WebContents;
  view: WebContentsView;
  url: string;
  ready: Promise<boolean>;
  open: boolean;
  /** The last search in this window, offered again when the bar reopens. */
  query: string;
  /** The latest request, so a slower result for older text never shows. */
  request?: number;
  dispose(): void;
}

export interface FindBarOptions {
  /** The page Find searches in this window, or nothing while it shows none (desktop settings, startup). */
  target(window: BrowserWindow): WebContents | undefined;
  /** Theme and bundled assets for the bar's page. */
  page(): LocalPageStyleOptions;
}

export function createFindBars(options: FindBarOptions) {
  const bars = new Map<BrowserWindow, Bar>();
  const alive = (bar: Bar) => bars.get(bar.parent) === bar && !bar.parent.isDestroyed() && !bar.view.webContents.isDestroyed() && !bar.target.isDestroyed();
  const send = (bar: Bar, channel: string, value: string) => { if (!bar.view.webContents.isDestroyed()) bar.view.webContents.send(channel, value); };

  function owner(event: IpcMainEvent) {
    for (const bar of bars.values()) {
      if (event.sender === bar.view.webContents && event.senderFrame === bar.view.webContents.mainFrame && event.senderFrame?.url === bar.url) return bar;
    }
    return undefined;
  }

  ipcMain.on('desktop:find', (event, action: unknown, value: unknown) => {
    const bar = owner(event);
    if (!bar || !alive(bar) || !bar.open) return;
    if (action === 'query' && typeof value === 'string') search(bar, value);
    else if (action === 'next' || action === 'previous') step(bar, action === 'next');
    else if (action === 'close') close(bar.parent);
  });

  function search(bar: Bar, text: string) {
    bar.query = text.slice(0, MAX_QUERY);
    if (!bar.query) {
      bar.request = undefined;
      bar.target.stopFindInPage('clearSelection');
      send(bar, 'desktop:find-result', '');
      return;
    }
    bar.request = bar.target.findInPage(bar.query, { findNext: true });
  }

  function step(bar: Bar, forward: boolean) {
    if (!bar.query) return;
    // Continue the search under way, or start one if the page dropped it.
    bar.request = bar.target.findInPage(bar.query, { forward, findNext: bar.request === undefined });
  }

  function position(bar: Bar) {
    if (!alive(bar)) return;
    const { width, height } = bar.parent.getContentBounds();
    bar.view.setBounds(findBarBounds({ width, height }));
  }

  function create(parent: BrowserWindow, target: WebContents): Bar {
    const view = new WebContentsView({ webPreferences: {
      preload: path.join(__dirname, 'find-preload.cjs'), partition: `ri-find-${randomBytes(16).toString('hex')}`,
      nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false,
    } });
    // Transparent around the card, so its shadow falls on the page beneath.
    view.setBackgroundColor('#00000000');
    view.setVisible(false);
    const contents = view.webContents;
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', event => event.preventDefault());
    contents.on('will-frame-navigate', event => event.preventDefault());
    contents.on('will-redirect', event => event.preventDefault());
    contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    contents.session.setPermissionCheckHandler(() => false);
    const nonce = randomBytes(24).toString('hex');
    // An unpredictable URL binds the bar's messages to this exact document.
    const url = `data:text/html;charset=utf-8,${encodeURIComponent(findBarPage(nonce, options.page()))}#${randomBytes(16).toString('hex')}`;

    const resize = () => position(bar);
    const found = (_event: unknown, result: Electron.Result) => {
      if (!bar.open || result.requestId !== bar.request) return;
      send(bar, 'desktop:find-result', matchLabel(result.activeMatchOrdinal, result.matches));
    };
    // A new document ends the search. Moving within the app keeps it, as a browser does.
    const navigated = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (details.isMainFrame && !details.isSameDocument) close(parent, 'clearSelection');
    };
    const gone = () => bar.dispose();
    // A closed page has no search left to stop.
    const targetGone = () => { bar.open = false; bar.dispose(); };
    const bar: Bar = {
      parent, target, view, url, open: false, query: '',
      ready: contents.loadURL(url).then(() => true, () => false),
      dispose() {
        if (bars.get(parent) === bar) bars.delete(parent);
        parent.removeListener('resize', resize);
        parent.removeListener('closed', gone);
        if (!target.isDestroyed()) {
          target.removeListener('found-in-page', found);
          target.removeListener('did-start-navigation', navigated);
          target.removeListener('destroyed', targetGone);
          if (bar.open) target.stopFindInPage('clearSelection');
        }
        bar.open = false;
        if (!parent.isDestroyed()) parent.contentView.removeChildView(view);
        if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false });
      },
    };
    bars.set(parent, bar);
    parent.on('resize', resize);
    parent.on('closed', gone);
    target.on('found-in-page', found);
    target.on('did-start-navigation', navigated);
    target.on('destroyed', targetGone);
    contents.on('render-process-gone', gone);
    return bar;
  }

  /** Open the bar, or bring it back to the search box if it is open. Searches again
   * for the last text, so the count and highlights reflect the page as it is now. */
  async function open(parent: BrowserWindow) {
    if (parent.isDestroyed()) return false;
    const target = options.target(parent);
    if (!target || target.isDestroyed()) return false;
    let bar = bars.get(parent);
    if (bar && (bar.target !== target || !alive(bar))) { bar.dispose(); bar = undefined; }
    bar ??= create(parent, target);
    const reopened = !bar.open;
    bar.open = true;
    position(bar);
    // Adding it again raises it above any view added since.
    parent.contentView.addChildView(bar.view);
    bar.view.setVisible(true);
    if (!await bar.ready) { if (bars.get(parent) === bar) bar.dispose(); return false; }
    if (!alive(bar) || !bar.open) return false;
    // A theme change while the bar's page was still loading would be lost.
    const { theme } = options.page();
    if (theme) send(bar, 'desktop:theme', theme);
    bar.view.webContents.focus();
    send(bar, 'desktop:find-open', bar.query);
    if (reopened && bar.query) search(bar, bar.query);
    return true;
  }

  /** Close the bar. The match the person stopped on stays selected, and focus
   * returns to the page if it was in the bar. */
  function close(parent: BrowserWindow, selection: 'keepSelection' | 'clearSelection' = 'keepSelection') {
    const bar = bars.get(parent);
    if (!bar?.open || !alive(bar)) return false;
    const focused = bar.view.webContents.isFocused();
    bar.open = false;
    bar.request = undefined;
    bar.view.setVisible(false);
    send(bar, 'desktop:find-result', '');
    bar.target.stopFindInPage(selection);
    if (focused) bar.target.focus();
    return true;
  }

  return {
    open,
    close,
    /** Find Next and Find Previous. With the bar closed, these open it on the last search. */
    async step(parent: BrowserWindow, forward: boolean) {
      const bar = bars.get(parent);
      if (bar?.open && alive(bar)) { step(bar, forward); return true; }
      return open(parent);
    },
    isOpen(parent: BrowserWindow) {
      const bar = bars.get(parent);
      return !!bar?.open && alive(bar);
    },
    theme(theme: DesktopTheme) {
      for (const bar of bars.values()) send(bar, 'desktop:theme', theme);
    },
  };
}

export type FindBars = ReturnType<typeof createFindBars>;

type FindCommand = (focused: BaseWindow | undefined) => void;

/** Electron's own Edit menu with Find added: in a Find submenu on macOS, as
 * Safari and Finder have it, and in the menu itself elsewhere. The page gets
 * each key first, so an editor with its own search (code views) keeps ⌘F. */
export function editMenu(platform: NodeJS.Platform, find: { find: FindCommand; next: FindCommand; previous: FindCommand }): MenuItemConstructorOptions {
  const items: MenuItemConstructorOptions[] = [
    { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: (_item, focused) => find.find(focused) },
    { label: 'Find Next', accelerator: 'CmdOrCtrl+G', click: (_item, focused) => find.next(focused) },
    { label: 'Find Previous', accelerator: 'Shift+CmdOrCtrl+G', click: (_item, focused) => find.previous(focused) },
  ];
  return { label: 'Edit', submenu: platform === 'darwin' ? [
    { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
    { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' },
    { type: 'separator' }, { label: 'Find', submenu: items },
    { type: 'separator' }, { label: 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] },
  ] : [
    { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
    { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'delete' }, { type: 'separator' }, { role: 'selectAll' },
    { type: 'separator' }, ...items,
  ] };
}
