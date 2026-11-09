/**
 * Ri's view, drawn inside ChatGPT, Claude or any MCP Apps host
 * (docs/mcp-oauth.md, "Views"). In a chat it's a card: today's deck or a
 * task list, where a check finishes a task, Start starts it and the title
 * opens it in full. Opened as the app (ChatGPT's sidebar or the tab beside
 * a chat), or with a card made full screen, it's Ri: Today, Tasks, Board,
 * Calendar, Notes, the Stream and the scratchpad, with search across tasks
 * and notes, and any task or note readable and editable in place.
 * Browser code: bundled into the view by `pnpm mcp-views:build`.
 */
import type { DeckView, TasksView } from '../data';
import type { BoardView, CalendarView, ItemView, NotesView, ScratchpadView, SearchView, StreamView } from '../screens';
import { connect, type HostContext } from './bridge';
import { back, current, go, isApp, reload, screenKey, state, hooks, type Loaded, type Screen } from './core';
import { fit, h, icon, ICONS } from './dom';
import { item, newNote } from './item';
import { calendar, clearCaptureNote, flushScratchpad, notes, scratchpad, search, searchField, stream } from './pages';
import { board, clearAddNote, deck, tasks } from './tasks';

const root = document.getElementById('root')!;
/** The arguments the model drew a task list with, so it stays filtered when redrawn. */
let toolArgs: Record<string, unknown> = {};

const TABS: Array<{ screen: Screen; label: string }> = [
  { screen: { name: 'deck' }, label: 'Today' },
  { screen: { name: 'tasks', args: { limit: 50 } }, label: 'Tasks' },
  { screen: { name: 'board' }, label: 'Board' },
  { screen: { name: 'calendar' }, label: 'Calendar' },
  { screen: { name: 'notes' }, label: 'Notes' },
  { screen: { name: 'stream' }, label: 'Stream' },
  { screen: { name: 'scratchpad' }, label: 'Scratchpad' },
];

function openTab(screen: Screen): void {
  clearAddNote();
  clearCaptureNote();
  if (state.stack.length === 1 && state.stack[0].name === screen.name) void reload();
  else go(screen, 'root');
}

/**
 * Kept across draws, so the row keeps where it was scrolled to at panel
 * width. Opening a tab brings it into view.
 */
const tabButtons = new Map(TABS.map(({ screen, label }) => [screen.name, h('button', { type: 'button', role: 'tab', className: 'tab', onClick: () => openTab(screen) }, label)]));
const head = h('div', { className: 'app-head' },
  h('nav', { className: 'tabs', role: 'tablist', 'aria-label': 'Ri' }, ...tabButtons.values()),
  h('div', { className: 'search' }, icon(ICONS.search, 14), searchField),
);
let shownTab: Screen['name'] | null = null;

function appHead(): HTMLElement {
  const active = state.stack[0].name;
  for (const [name, button] of tabButtons) {
    button.setAttribute('aria-selected', String(name === active));
    button.classList.toggle('on', name === active);
  }
  if (shownTab !== active) {
    shownTab = active;
    const button = tabButtons.get(active);
    requestAnimationFrame(() => {
      const nav = button?.parentElement;
      if (!button || !nav) return;
      // Sideways only: the page itself never moves for this.
      if (button.offsetLeft < nav.scrollLeft) nav.scrollLeft = button.offsetLeft - 4;
      else if (button.offsetLeft + button.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = button.offsetLeft + button.offsetWidth - nav.clientWidth + 28;
    });
  }
  return head;
}

const BACK_TO: Partial<Record<Screen['name'], string>> = { deck: 'Today', tasks: 'Tasks', board: 'Board', calendar: 'Calendar', notes: 'Notes', search: 'Results', stream: 'Stream', scratchpad: 'Scratchpad' };

function backBar(): HTMLElement {
  const before = state.stack[state.stack.length - 2];
  const label = BACK_TO[before.name] ?? 'Back';
  return h('div', { className: 'back-bar' }, h('button', { type: 'button', className: 'back', onClick: back }, icon(ICONS.back, 14), label));
}

function kindOf(loaded: Loaded): string {
  return 'view' in loaded ? loaded.view : loaded.screen;
}

function draw(screen: Screen, loaded: Loaded | undefined): Node[] {
  if (screen.name === 'new-note') return newNote();
  if (!loaded || kindOf(loaded) !== (screen.name === 'deck' ? 'deck' : screen.name)) {
    return state.stale ? [] : [h('p', { className: 'loading', role: 'status' }, 'Loading from Ri')];
  }
  switch (screen.name) {
    case 'deck': return deck(loaded as DeckView);
    case 'tasks': return tasks(loaded as TasksView);
    case 'board': return board(loaded as BoardView);
    case 'calendar': return calendar(loaded as CalendarView);
    case 'notes': return notes(loaded as NotesView);
    case 'search': return search(loaded as SearchView);
    case 'item': return item(loaded as ItemView);
    case 'stream': return stream(loaded as StreamView);
    case 'scratchpad': return scratchpad(loaded as ScratchpadView);
  }
}

function render(): void {
  // Before anything moves. Drawing moves the kept fields, which drops their
  // focus, so it's given back below: a change landing never interrupts typing.
  const focused = document.activeElement;
  const selection = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement ? [focused.selectionStart, focused.selectionEnd] as const : null;
  const screen = current();
  document.documentElement.dataset.screen = screen.name;
  document.documentElement.dataset.app = isApp() ? 'app' : 'card';
  const nodes: Node[] = [];
  if (isApp()) nodes.push(appHead());
  if (state.stack.length > 1) nodes.push(backBar());
  if (state.notice) nodes.push(h('p', { className: 'notice', role: 'status' }, state.notice));
  if (state.stale) nodes.push(h('p', { className: 'notice', role: 'status' }, 'This view may be out of date. ', h('button', { type: 'button', className: 'retry', onClick: () => void reload() }, 'Try again')));
  nodes.push(...draw(screen, state.loaded.get(screenKey(screen))));
  root.replaceChildren(...nodes);
  for (const area of root.querySelectorAll<HTMLTextAreaElement>('textarea.grow')) fit(area);
  if (focused instanceof HTMLElement && focused !== document.body && root.contains(focused) && document.activeElement !== focused) {
    focused.focus();
    if (selection && (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement)) focused.setSelectionRange(selection[0], selection[1]);
  }
}
hooks.render = render;

/** What the model's tool drew: today's deck, a list, or the app itself. */
function shown(data: DeckView | TasksView): void {
  if (data?.view !== 'deck' && data?.view !== 'tasks') return;
  const screen: Screen = data.view === 'deck' ? { name: 'deck' } : { name: 'tasks', args: toolArgs };
  if (data.view === 'deck' && data.app) state.appEntry = true;
  if (!state.appEntry) state.cardRoot = screen;
  state.loaded.set(screenKey(screen), data);
  if (!state.moved) state.stack = [screen];
  state.notice = null;
  render();
}

// ─── The host's look ──────────────────────────────────────────

function applyContext(context: HostContext): void {
  const html = document.documentElement;
  if (context.theme) html.dataset.theme = context.theme;
  html.dataset.display = context.displayMode === 'fullscreen' ? 'fullscreen' : 'inline';
  for (const [name, value] of Object.entries(context.styles?.variables ?? {})) {
    if (name.startsWith('--') && value) html.style.setProperty(name, value);
  }
  if (context.styles?.css?.fonts && !document.getElementById('host-fonts')) {
    document.head.append(h('style', { id: 'host-fonts' }, context.styles.css.fonts));
  }
  html.dataset.hover = context.deviceCapabilities?.hover === false || context.deviceCapabilities?.touch ? 'none' : 'hover';
  if (context.locale) html.lang = context.locale;
  // A full-screen card back in its place in the chat goes back to what the chat drew.
  if (!isApp() && state.cardRoot && state.stack[0].name !== state.cardRoot.name) state.stack = [state.cardRoot];
}

// ─── Start ────────────────────────────────────────────────────

render();
connect({
  toolInput: args => { toolArgs = args; },
  toolResult: result => {
    if (result.isError || !result.structuredContent) { state.notice = 'Ri couldn’t load this.'; render(); return; }
    shown(result.structuredContent as unknown as DeckView | TasksView);
  },
  hostContext: context => { applyContext(context); render(); },
  cancelled: () => { if (!state.loaded.size) { state.notice = 'Cancelled.'; render(); } },
  teardown: () => flushScratchpad(),
}).then(connected => {
  state.bridge = connected;
  applyContext(connected.context);
  render();
  let last = 0;
  new ResizeObserver(() => {
    const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
    if (height !== last) { last = height; connected.sizeChanged(height); }
  }).observe(document.documentElement);
}).catch(() => {
  state.notice = 'This view needs an app that shows MCP views.';
  render();
});
