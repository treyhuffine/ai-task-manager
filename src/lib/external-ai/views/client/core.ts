/**
 * What every screen of Ri's view shares: the host connection, where the
 * person is (a stack of screens), what each screen last loaded, and the
 * calls that read and change Ri through the host.
 * Browser code: bundled into the view by `pnpm mcp-views:build`.
 */
import type { DeckView, TasksView, ViewTask } from '../data';
import type { ScreenView } from '../screens';
import type { Bridge, ToolResult } from './bridge';

export type Screen =
  | { name: 'deck' }
  | { name: 'tasks'; args: Record<string, unknown> }
  | { name: 'board' }
  | { name: 'calendar'; start?: string }
  | { name: 'notes' }
  | { name: 'search'; query: string }
  | { name: 'item'; type: 'task' | 'note'; id: string }
  | { name: 'new-note' }
  | { name: 'stream' }
  | { name: 'scratchpad' };

export type Loaded = DeckView | TasksView | ScreenView;

export const state = {
  bridge: null as Bridge | null,
  /** Opened as the app itself (the sidebar entry or the tab beside a chat), not a card in a chat. */
  appEntry: false,
  /** Where the person is. The first screen is the tab, the rest were opened from it and Back returns. */
  stack: [{ name: 'deck' }] as Screen[],
  /** The card a chat drew, to return to if a full-screen card goes back to its place in the chat. */
  cardRoot: null as Screen | null,
  /** What each screen last loaded, by `screenKey`, so Back and tabs draw at once while Ri is asked again. */
  loaded: new Map<string, Loaded>(),
  /** The last load of the screen on show failed, so it may be behind. */
  stale: false,
  /** A message about the whole view, such as a failed first load. */
  notice: null as string | null,
  /** The person has moved around, so a tool result the host sends again doesn't take them back. */
  moved: false,
};

export const hooks = {
  render: () => {},
  /** Called before the person leaves a screen, so a screen with unsaved text can save it. */
  leaving: [] as Array<() => void>,
};

export function redraw(): void {
  hooks.render();
}

export function current(): Screen {
  return state.stack[state.stack.length - 1];
}

export function screenKey(screen: Screen): string {
  return JSON.stringify(screen);
}

export function isApp(): boolean {
  return state.appEntry || state.bridge?.context.displayMode === 'fullscreen';
}

// ─── Talking to Ri ────────────────────────────────────────────

export type Outcome<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; code: string | null; message: string; details?: unknown };

interface Envelope { ok: boolean; result?: unknown; error?: { code?: string; message?: string; details?: unknown } }

function envelopeOf(result: ToolResult): Envelope {
  const text = result.content?.find(part => part.type === 'text')?.text;
  try { return text ? JSON.parse(text) as Envelope : { ok: !result.isError }; }
  catch { return { ok: !result.isError, error: { message: text } }; }
}

/** Runs one of Ri's content tools (`complete_task`, `update_note`...) and says how it went, in words a person can read. */
export async function act<T = unknown>(name: string, args: Record<string, unknown>): Promise<Outcome<T>> {
  if (!state.bridge) return { ok: false, code: null, message: 'Ri isn’t connected.' };
  try {
    const result = await state.bridge.callTool(name, args);
    const envelope = envelopeOf(result);
    if (result.isError || !envelope.ok) {
      return { ok: false, code: envelope.error?.code ?? null, message: envelope.error?.message?.slice(0, 240) || 'Ri couldn’t make that change.', details: envelope.error?.details };
    }
    return { ok: true, result: envelope.result as T };
  } catch {
    return { ok: false, code: null, message: 'Ri didn’t answer. Try again.' };
  }
}

/** A view tool's own answer (`show_deck`, `load_view`, `save_scratchpad`). Throws when Ri didn't give one. */
export async function view<T>(name: string, args: Record<string, unknown>): Promise<T> {
  if (!state.bridge) throw new Error('Not connected');
  const result = await state.bridge.callTool(name, args);
  if (result.isError || !result.structuredContent) throw new Error(result.content?.find(part => part.type === 'text')?.text || 'Ri couldn’t load this.');
  return result.structuredContent as unknown as T;
}

export function idempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function request(screen: Screen): Promise<Loaded> | null {
  switch (screen.name) {
    case 'deck': return view<DeckView>('show_deck', {});
    case 'tasks': return view<TasksView>('show_tasks', screen.args);
    case 'new-note': return null;
    case 'calendar': return view<ScreenView>('load_view', { screen: 'calendar', ...(screen.start ? { start: screen.start } : {}) });
    case 'search': return view<ScreenView>('load_view', { screen: 'search', query: screen.query });
    case 'item': return view<ScreenView>('load_view', { screen: 'item', type: screen.type, id: screen.id });
    default: return view<ScreenView>('load_view', { screen: screen.name });
  }
}

/** Asks Ri again for the screen on show, and draws it. Another screen opened meanwhile keeps its own. */
export async function reload(): Promise<void> {
  const screen = current();
  const key = screenKey(screen);
  const pending = request(screen);
  if (!pending) return;
  try {
    const loaded = await pending;
    state.loaded.set(key, loaded);
    if (screenKey(current()) === key) state.stale = false;
  } catch {
    if (screenKey(current()) === key) state.stale = true;
  }
  if (screenKey(current()) === key) redraw();
}

function leave(): void {
  for (const save of hooks.leaving) save();
}

/** Opens a screen: as a new tab (`root`), or on top of this one, with Back. */
export function go(screen: Screen, how: 'root' | 'push' | 'replace' = 'push'): void {
  leave();
  state.moved = true;
  if (how === 'root') {
    state.stack = [screen];
    kept.clear();
  } else if (how === 'replace') {
    state.stack = [...state.stack.slice(0, -1), screen];
  } else {
    state.stack = [...state.stack, screen];
  }
  state.stale = false;
  window.scrollTo(0, 0);
  redraw();
  tellScreen(screen);
  void reload();
}

export function back(): void {
  if (state.stack.length < 2) return;
  leave();
  state.stack = state.stack.slice(0, -1);
  state.stale = false;
  redraw();
  tellScreen(current());
  void reload();
}

export function openItem(type: 'task' | 'note', id: string): void {
  const top = current();
  go({ name: 'item', type, id }, top.name === 'item' && top.type === type && top.id === id ? 'replace' : 'push');
}

// ─── The host ─────────────────────────────────────────────────

export function open(url: string | null | undefined): void {
  if (url && state.bridge) void state.bridge.openLink(url).catch(() => {});
}

/** Tells the model what the person is doing in the view, for its next turn. Each call replaces the last. */
export function tell(text: string): void {
  void state.bridge?.updateModelContext(text).catch(() => {});
}

const SCREEN_NAMES: Record<Screen['name'], string> = {
  deck: 'today’s deck', tasks: 'their task list', board: 'the board', calendar: 'the calendar', notes: 'their notes',
  search: 'search results', item: 'an item', 'new-note': 'a new note', stream: 'the Stream (their capture inbox)', scratchpad: 'their scratchpad',
};

/** An item's own words are told when it's drawn (`tellItem`). The Stream and scratchpad are only named, never read out. */
function tellScreen(screen: Screen): void {
  if (screen.name !== 'item') tell(`In the Ri app, the person is looking at ${SCREEN_NAMES[screen.name]}.`);
}

export function tellItem(type: 'task' | 'note', id: string, title: string, facts = ''): void {
  tell(`In the Ri app, the person has the ${type} "${title}" open (ID ${id}${facts ? `, ${facts}` : ''}). If they ask about "this", it's probably this ${type}: read it with get_${type}.`);
}

// ─── Tasks finished here ──────────────────────────────────────

/**
 * Tasks finished in a list that leaves finished tasks out (the task list, a
 * board column, a day's deadlines). Without this a tick would make the row
 * vanish with no way back, so it stays where it was, ticked, until the
 * person changes tab.
 */
export const kept = new Map<string, { task: ViewTask; list: string; index: number }>();

export function withKept(list: string, items: ViewTask[]): ViewTask[] {
  const merged = [...items];
  for (const { task, list: where, index } of kept.values()) {
    if (where === list && !merged.some(item => item.id === task.id)) merged.splice(Math.min(index, merged.length), 0, task);
  }
  return merged;
}

// ─── Dates, in the host's language and zone ───────────────────

export function locale(): string | undefined {
  return state.bridge?.context.locale || undefined;
}

export function localDay(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function dayLabel(value: string, withWeekday = true): string {
  return localDay(value).toLocaleDateString(locale(), withWeekday ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' });
}

export function timeLabel(value: string): string {
  return new Date(value).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' });
}

/** "Just now", "3h ago", "Yesterday", then a date: when something was written. */
export function whenLabel(value: string, now = new Date()): string {
  const then = new Date(value);
  const minutes = Math.round((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 12) return `${Math.round(minutes / 60)}h ago`;
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return then.toLocaleDateString(locale(), { month: 'short', day: 'numeric', ...(then.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
}
