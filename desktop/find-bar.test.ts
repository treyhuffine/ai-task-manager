import type { BaseWindow, BrowserWindow, MenuItemConstructorOptions, WebContents } from 'electron';
import { beforeEach, expect, it, vi } from 'vitest';
import { closesFindBar, createFindBars, editMenu, findBarBounds, matchLabel, FIND_BAR } from './find-bar';

const mocks = vi.hoisted(() => {
  const state = {
    views: [] as MockView[], requestId: 0, failLoad: false,
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => void>(),
  };
  class Events {
    listeners = new Map<string, ((...args: unknown[]) => void)[]>();
    on(name: string, handler: (...args: unknown[]) => void) { this.listeners.set(name, [...this.listeners.get(name) ?? [], handler]); return this; }
    removeListener(name: string, handler: (...args: unknown[]) => void) { this.listeners.set(name, (this.listeners.get(name) ?? []).filter(item => item !== handler)); return this; }
    emit(name: string, ...args: unknown[]) { for (const handler of this.listeners.get(name) ?? []) handler(...args); }
    count(name: string) { return this.listeners.get(name)?.length ?? 0; }
  }
  class Contents extends Events {
    destroyed = false;
    focused = false;
    mainFrame = { url: '' };
    setWindowOpenHandler = vi.fn();
    session = { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() };
    send = vi.fn();
    loadURL = vi.fn(async (url: string) => {
      if (state.failLoad) throw new Error('load failed');
      this.mainFrame = { url };
    });
    focus = vi.fn(() => { this.focused = true; });
    isFocused() { return this.focused; }
    isDestroyed() { return this.destroyed; }
    close = vi.fn(() => { this.destroyed = true; this.emit('destroyed'); });
    findInPage = vi.fn<(text: string, options?: object) => number>(() => ++state.requestId);
    stopFindInPage = vi.fn();
  }
  class MockView {
    webContents = new Contents();
    setBounds = vi.fn();
    setVisible = vi.fn();
    setBackgroundColor = vi.fn();
    constructor(readonly options: unknown) { state.views.push(this); }
  }
  class MockParent extends Events {
    destroyed = false;
    bounds = { x: 700, y: 500, width: 1440, height: 980 };
    webContents = new Contents();
    contentView = { addChildView: vi.fn(), removeChildView: vi.fn() };
    getContentBounds() { return this.bounds; }
    isDestroyed() { return this.destroyed; }
  }
  return { state, Contents, MockParent, WebContentsView: MockView };
});

vi.mock('electron', () => ({
  WebContentsView: mocks.WebContentsView,
  ipcMain: { on: (name: string, handler: (event: unknown, ...args: unknown[]) => void) => mocks.state.handlers.set(name, handler) },
}));

type Parent = InstanceType<typeof mocks.MockParent>;
type View = InstanceType<typeof mocks.WebContentsView>;

function fixture(available = true) {
  const parent = new mocks.MockParent();
  const target = vi.fn((win: BrowserWindow) => available ? win.webContents : undefined);
  const bars = createFindBars({ target, page: () => ({ theme: 'dark', platform: 'darwin' }) });
  const win = parent as unknown as BrowserWindow;
  return { parent, win, page: parent.webContents, bars, target };
}
const view = () => mocks.state.views.at(-1)!;
function ipc(action: string, value?: unknown, from: View = view(), frame?: unknown) {
  const sender = from.webContents;
  mocks.state.handlers.get('desktop:find')!({ sender, senderFrame: frame ?? sender.mainFrame }, action, value);
}
const found = (parent: Parent, requestId: number, activeMatchOrdinal: number, matches: number) =>
  parent.webContents.emit('found-in-page', {}, { requestId, activeMatchOrdinal, matches, selectionArea: { x: 0, y: 0, width: 0, height: 0 }, finalUpdate: true });
const sent = (channel: string) => view().webContents.send.mock.calls.filter(([name]) => name === channel).map(([, value]) => value);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.views.length = 0; mocks.state.handlers.clear(); mocks.state.requestId = 0; mocks.state.failLoad = false;
});

it('places the bar under the title bar at the right, never past the left edge', () => {
  expect(findBarBounds({ width: 1440, height: 980 })).toEqual({ x: 1440 - FIND_BAR.width - FIND_BAR.right, y: 40, width: FIND_BAR.width, height: FIND_BAR.height });
  expect(findBarBounds({ width: 200, height: 600 })).toEqual({ x: 0, y: 40, width: 200, height: FIND_BAR.height });
  expect(findBarBounds({ width: 0, height: 0 }).width).toBe(0);
});

it('labels where a search stands', () => {
  expect(matchLabel(3, 12)).toBe('3 of 12');
  expect(matchLabel(1, 1)).toBe('1 of 1');
  expect(matchLabel(0, 0)).toBe('No results');
  expect(matchLabel(0, 1)).toBe('1 match');
  expect(matchLabel(0, 4)).toBe('4 matches');
  expect(matchLabel(Number.NaN, Number.NaN)).toBe('No results');
});

it('opens an isolated, transparent bar over the page and focuses its search box', async () => {
  const { parent, win, bars } = fixture();
  expect(await bars.open(win)).toBe(true);
  const bar = view();
  expect(bar.options).toMatchObject({ webPreferences: {
    preload: expect.stringContaining('find-preload.cjs'), partition: expect.stringMatching(/^ri-find-[0-9a-f]{32}$/),
    sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false,
  } });
  expect(bar.setBackgroundColor).toHaveBeenCalledWith('#00000000');
  expect(bar.webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' });
  const deny = vi.fn();
  bar.webContents.session.setPermissionRequestHandler.mock.calls[0][0](null, 'media', deny);
  expect(deny).toHaveBeenCalledWith(false);
  expect(bar.webContents.session.setPermissionCheckHandler.mock.calls[0][0]()).toBe(false);
  for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
    const event = { preventDefault: vi.fn() };
    bar.webContents.emit(name, event);
    expect(event.preventDefault).toHaveBeenCalled();
  }
  const url = bar.webContents.loadURL.mock.calls[0][0];
  expect(url).toMatch(/^data:text\/html;charset=utf-8,.+#[0-9a-f]{32}$/);
  expect(decodeURIComponent(url)).toContain('data-ri-local-view="find"');
  expect(bar.setBounds).toHaveBeenLastCalledWith(findBarBounds(parent.bounds));
  expect(parent.contentView.addChildView).toHaveBeenLastCalledWith(bar);
  expect(bar.setVisible).toHaveBeenLastCalledWith(true);
  expect(bar.webContents.focus).toHaveBeenCalled();
  expect(sent('desktop:theme')).toEqual(['dark']);
  expect(sent('desktop:find-open')).toEqual(['']);
  expect(parent.webContents.findInPage).not.toHaveBeenCalled();
  expect(bars.isOpen(win)).toBe(true);
});

it('does nothing where there is no page to search', async () => {
  const { win, bars } = fixture(false);
  expect(await bars.open(win)).toBe(false);
  expect(await bars.step(win, true)).toBe(false);
  expect(mocks.state.views).toHaveLength(0);
  expect(bars.isOpen(win)).toBe(false);
});

it('searches as the person types and shows only the latest result', async () => {
  const { parent, win, bars } = fixture();
  await bars.open(win);
  ipc('query', 'ri');
  expect(parent.webContents.findInPage).toHaveBeenLastCalledWith('ri', { findNext: true });
  ipc('query', 'ris');
  expect(parent.webContents.findInPage).toHaveBeenLastCalledWith('ris', { findNext: true });
  found(parent, 1, 1, 9);
  expect(sent('desktop:find-result')).toEqual([]);
  found(parent, 2, 1, 3);
  expect(sent('desktop:find-result')).toEqual(['1 of 3']);
  ipc('next');
  expect(parent.webContents.findInPage).toHaveBeenLastCalledWith('ris', { forward: true, findNext: false });
  found(parent, 3, 2, 3);
  ipc('previous');
  expect(parent.webContents.findInPage).toHaveBeenLastCalledWith('ris', { forward: false, findNext: false });
  found(parent, 4, 1, 3);
  expect(sent('desktop:find-result')).toEqual(['1 of 3', '2 of 3', '1 of 3']);
  ipc('query', 'x'.repeat(5000));
  expect(parent.webContents.findInPage.mock.lastCall![0]).toHaveLength(1000);
});

it('clears the page and the count when the box is emptied', async () => {
  const { parent, win, bars } = fixture();
  await bars.open(win);
  ipc('query', 'ri');
  ipc('query', '');
  expect(parent.webContents.stopFindInPage).toHaveBeenLastCalledWith('clearSelection');
  expect(sent('desktop:find-result')).toEqual(['']);
  const calls = parent.webContents.findInPage.mock.calls.length;
  ipc('next'); ipc('previous');
  expect(parent.webContents.findInPage).toHaveBeenCalledTimes(calls);
  found(parent, 1, 1, 2);
  expect(sent('desktop:find-result')).toEqual(['']);
});

it('accepts messages only from the bar’s own document and main frame', async () => {
  const { parent, win, bars } = fixture();
  await bars.open(win);
  const bar = view();
  const page = { webContents: parent.webContents } as unknown as View;
  ipc('query', 'from page', page);
  ipc('query', 'from subframe', bar, { url: bar.webContents.mainFrame.url });
  bar.webContents.mainFrame = { url: 'data:text/html,other' };
  ipc('query', 'from another document', bar);
  ipc('close', undefined, page);
  expect(parent.webContents.findInPage).not.toHaveBeenCalled();
  expect(bars.isOpen(win)).toBe(true);
  for (const value of [undefined, 1, { text: 'x' }]) ipc('query', value, bar, bar.webContents.mainFrame);
  ipc('unknown', 'x', bar, bar.webContents.mainFrame);
  expect(parent.webContents.findInPage).not.toHaveBeenCalled();
});

it('closes back to the page, keeping the match selected', async () => {
  const { parent, win, bars } = fixture();
  await bars.open(win);
  ipc('query', 'ri');
  ipc('close');
  expect(bars.isOpen(win)).toBe(false);
  expect(view().setVisible).toHaveBeenLastCalledWith(false);
  expect(parent.webContents.stopFindInPage).toHaveBeenLastCalledWith('keepSelection');
  expect(parent.webContents.focus).toHaveBeenCalledOnce();
  expect(sent('desktop:find-result')).toEqual(['']);
  found(parent, 1, 1, 4);
  expect(sent('desktop:find-result')).toEqual(['']);
  ipc('query', 'closed');
  expect(parent.webContents.findInPage).toHaveBeenCalledTimes(1);
  expect(bars.close(win)).toBe(false);
});

it('leaves focus alone when the bar closes while the page has it', async () => {
  const { parent, win, bars } = fixture();
  await bars.open(win);
  view().webContents.focused = false;
  expect(bars.close(win)).toBe(true);
  expect(parent.webContents.focus).not.toHaveBeenCalled();
});

const key = (input: Partial<Electron.Input> = {}) =>
  ({ type: 'keyDown', key: 'Escape', isComposing: false, shift: false, control: false, alt: false, meta: false, ...input }) as Electron.Input;
function press(parent: Parent, input: Electron.Input) {
  const event = { preventDefault: vi.fn() };
  parent.webContents.emit('before-input-event', event, input);
  return event.preventDefault.mock.calls.length > 0;
}

it('closes on a plain Escape only', () => {
  expect(closesFindBar(key())).toBe(true);
  for (const input of [
    key({ type: 'keyUp' }), key({ key: 'Esc' }), key({ key: 'Enter' }), key({ isComposing: true }),
    key({ shift: true }), key({ control: true }), key({ alt: true }), key({ meta: true }),
  ]) expect(closesFindBar(input)).toBe(false);
});

it('closes on Escape from the page it searches, which never sees that Escape', async () => {
  const { parent, win, bars } = fixture();
  await bars.open(win);
  ipc('query', 'ri');
  // A click into the page took focus from the bar.
  view().webContents.focused = false;
  for (const input of [key({ shift: true }), key({ meta: true }), key({ type: 'keyUp' }), key({ isComposing: true })]) {
    expect(press(parent, input)).toBe(false);
  }
  expect(bars.isOpen(win)).toBe(true);
  expect(press(parent, key())).toBe(true);
  expect(bars.isOpen(win)).toBe(false);
  expect(view().setVisible).toHaveBeenLastCalledWith(false);
  expect(parent.webContents.stopFindInPage).toHaveBeenLastCalledWith('keepSelection');
  expect(parent.webContents.focus).not.toHaveBeenCalled();
  // Closed, the page has Escape back.
  expect(press(parent, key())).toBe(false);
  await bars.open(win);
  expect(press(parent, key())).toBe(true);
});

it('reopens on the last search and searches the page as it is now', async () => {
  const { parent, win, bars } = fixture();
  await bars.open(win);
  ipc('query', 'deck');
  bars.close(win);
  await bars.open(win);
  expect(mocks.state.views).toHaveLength(1);
  expect(sent('desktop:find-open')).toEqual(['', 'deck']);
  expect(parent.webContents.findInPage).toHaveBeenLastCalledWith('deck', { findNext: true });
  expect(parent.contentView.addChildView).toHaveBeenCalledTimes(2);
  // Find again while open returns to the box without restarting the search.
  const calls = parent.webContents.findInPage.mock.calls.length;
  await bars.open(win);
  expect(sent('desktop:find-open')).toEqual(['', 'deck', 'deck']);
  expect(parent.webContents.findInPage).toHaveBeenCalledTimes(calls);
});

it('steps through matches with the bar open, and opens it on the last search when closed', async () => {
  const { parent, win, bars } = fixture();
  expect(await bars.step(win, true)).toBe(true);
  expect(bars.isOpen(win)).toBe(true);
  expect(parent.webContents.findInPage).not.toHaveBeenCalled();
  ipc('query', 'note');
  await bars.step(win, false);
  expect(parent.webContents.findInPage).toHaveBeenLastCalledWith('note', { forward: false, findNext: false });
  bars.close(win);
  await bars.step(win, true);
  expect(parent.webContents.findInPage).toHaveBeenLastCalledWith('note', { findNext: true });
  await bars.step(win, true);
  expect(parent.webContents.findInPage).toHaveBeenLastCalledWith('note', { forward: true, findNext: false });
});

it('closes on a new document but stays open moving within the app', async () => {
  const { parent, win, bars } = fixture();
  await bars.open(win);
  ipc('query', 'ri');
  parent.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
  parent.webContents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
  expect(bars.isOpen(win)).toBe(true);
  parent.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  expect(bars.isOpen(win)).toBe(false);
  expect(parent.webContents.stopFindInPage).toHaveBeenLastCalledWith('clearSelection');
});

it('follows the window size and lets go of everything when the window closes', async () => {
  const { parent, win, bars } = fixture();
  await bars.open(win);
  const bar = view();
  parent.bounds = { x: 0, y: 0, width: 1024, height: 768 };
  parent.emit('resize');
  expect(bar.setBounds).toHaveBeenLastCalledWith(findBarBounds(parent.bounds));
  parent.destroyed = true;
  parent.emit('closed');
  expect(bar.webContents.close).toHaveBeenCalledWith({ waitForBeforeUnload: false });
  expect(parent.contentView.removeChildView).not.toHaveBeenCalled();
  for (const name of ['found-in-page', 'did-start-navigation', 'before-input-event', 'destroyed']) expect(parent.webContents.count(name)).toBe(0);
  expect(parent.count('resize') + parent.count('closed')).toBe(0);
  expect(bars.isOpen(win)).toBe(false);
});

it('drops a closed page’s bar without touching the page, and starts over on the next Find', async () => {
  const { parent, win, bars } = fixture();
  await bars.open(win);
  const first = view();
  parent.webContents.destroyed = true;
  parent.webContents.emit('destroyed');
  expect(parent.webContents.stopFindInPage).not.toHaveBeenCalled();
  expect(parent.contentView.removeChildView).toHaveBeenCalledWith(first);
  expect(first.webContents.close).toHaveBeenCalled();
  parent.webContents = new mocks.Contents();
  await bars.open(win);
  expect(mocks.state.views).toHaveLength(2);
  expect(view()).not.toBe(first);
});

it('starts a fresh bar after its own page crashes or fails to load', async () => {
  const { win, bars } = fixture();
  await bars.open(win);
  view().webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  expect(bars.isOpen(win)).toBe(false);
  mocks.state.failLoad = true;
  expect(await bars.open(win)).toBe(false);
  expect(mocks.state.views).toHaveLength(2);
  mocks.state.failLoad = false;
  expect(await bars.open(win)).toBe(true);
  expect(mocks.state.views).toHaveLength(3);
});

it('keeps a separate bar and search per window and passes theme changes to each', async () => {
  const first = fixture();
  const bars = first.bars;
  const second = new mocks.MockParent();
  const secondWin = second as unknown as BrowserWindow;
  await bars.open(first.win);
  await bars.open(secondWin);
  const [a, b] = mocks.state.views;
  ipc('query', 'one', a);
  ipc('query', 'two', b);
  expect(first.parent.webContents.findInPage).toHaveBeenLastCalledWith('one', { findNext: true });
  expect(second.webContents.findInPage).toHaveBeenLastCalledWith('two', { findNext: true });
  bars.theme('light');
  for (const bar of [a, b]) expect(bar.webContents.send).toHaveBeenLastCalledWith('desktop:theme', 'light');
});

it('adds Find to Electron’s Edit menu for the focused window', () => {
  const find = { find: vi.fn(), next: vi.fn(), previous: vi.fn() };
  const focused = {} as BaseWindow;
  const mac = editMenu('darwin', find);
  const macItems = mac.submenu as MenuItemConstructorOptions[];
  expect(mac.label).toBe('Edit');
  expect(macItems.map(item => item.role ?? item.label ?? item.type)).toEqual([
    'undo', 'redo', 'separator', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'delete', 'selectAll', 'separator', 'Find', 'separator', 'Speech',
  ]);
  const findMenu = macItems.find(item => item.label === 'Find')!.submenu as MenuItemConstructorOptions[];
  expect(findMenu.map(item => [item.label, item.accelerator])).toEqual([
    ['Find…', 'CmdOrCtrl+F'], ['Find Next', 'CmdOrCtrl+G'], ['Find Previous', 'Shift+CmdOrCtrl+G'],
  ]);
  const click = (item: MenuItemConstructorOptions) => item.click!({} as never, focused, {} as never);
  findMenu.forEach(click);
  expect(find.find).toHaveBeenCalledWith(focused);
  expect(find.next).toHaveBeenCalledWith(focused);
  expect(find.previous).toHaveBeenCalledWith(focused);
  const linux = (editMenu('linux', find).submenu as MenuItemConstructorOptions[]).map(item => item.role ?? item.label ?? item.type);
  expect(linux).toEqual(['undo', 'redo', 'separator', 'cut', 'copy', 'paste', 'delete', 'separator', 'selectAll', 'separator', 'Find…', 'Find Next', 'Find Previous']);
});

it('asks for the page to search on every Find, so a covered app is never searched', async () => {
  const parent = new mocks.MockParent();
  const win = parent as unknown as BrowserWindow;
  let page: WebContents | undefined;
  const bars = createFindBars({ target: () => page, page: () => ({}) });
  expect(await bars.open(win)).toBe(false);
  page = parent.webContents as unknown as WebContents;
  expect(await bars.open(win)).toBe(true);
  bars.close(win);
  page = undefined;
  expect(await bars.open(win)).toBe(false);
  expect(bars.isOpen(win)).toBe(false);
});
