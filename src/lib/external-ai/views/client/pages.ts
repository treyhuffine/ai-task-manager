/**
 * The view's other screens: the calendar, notes, search results, the Stream
 * and the scratchpad. The Stream and scratchpad are drawn for the person
 * only: the model is told which screen is open, never what's on it, and
 * reads one only when the person adds it to their message.
 * Browser code: bundled into the view by `pnpm mcp-views:build`.
 */
import type { CalendarDayView, CalendarView, NotesView, ScratchpadSaved, ScratchpadView, SearchView, StreamView, ViewCapture, ViewEvent } from '../screens';
import { act, back, current, dayLabel, go, hooks, localDay, open, redraw, reload, state, tell, timeLabel, view, whenLabel, withKept } from './core';
import { dotted, field, fit, h, icon, ICONS, textArea } from './dom';
import { addToMessage, draftButton, footer, noteRow, row, rowFeedback, section, toggleOpen } from './tasks';

// ─── The calendar ─────────────────────────────────────────────

function shift(date: string, days: number): string {
  const day = localDay(date);
  day.setDate(day.getDate() + days);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

function eventRow(event: ViewEvent): HTMLLIElement {
  const when = event.allDay ? 'All day' : `${timeLabel(event.start)} to ${timeLabel(event.end)}`;
  return h('li', { className: `event${event.declined ? ' declined' : ''}` },
    h('span', { className: 'event-bar', style: event.color ? `background:${/^#[0-9a-f]{3,8}$/i.test(event.color) ? event.color : 'var(--line)'}` : undefined, 'aria-hidden': 'true' }),
    h('div', { className: 'body' },
      event.sourceUrl
        ? h('button', { type: 'button', className: 'title link', onClick: () => open(event.sourceUrl) }, h('span', { className: 'title-text' }, event.title || 'Busy'))
        : h('span', { className: 'title' }, event.title || 'Busy'),
      h('div', { className: 'meta' }, ...dotted([h('span', {}, when), event.location ? h('span', {}, event.location) : null, event.declined ? h('span', {}, 'Declined') : null].filter((node): node is HTMLSpanElement => Boolean(node)))),
    ),
    event.joinUrl ? h('button', { type: 'button', className: 'button join', onClick: () => open(event.joinUrl) }, icon(ICONS.video, 13), 'Join') : null,
  );
}

function day(data: CalendarDayView, today: string): HTMLElement {
  const deadlines = withKept(`calendar:${data.date}`, data.deadlines);
  const events = [...data.allDay, ...data.events];
  const empty = !events.length && !deadlines.length;
  return h('section', { className: `day${data.date === today ? ' today' : ''}` },
    h('header', { className: 'section-head' }, h('h2', {}, dayLabel(data.date)), data.date === today ? h('span', { className: 'chip' }, 'Today') : null),
    events.length ? h('ul', { className: 'events' }, ...events.map(eventRow)) : null,
    deadlines.length ? h('ul', { className: 'deadlines' }, ...deadlines.map((task, index) => row(task, { list: `calendar:${data.date}`, index }))) : null,
    empty ? h('p', { className: 'empty' }, 'Nothing scheduled.') : null,
  );
}

export function calendar(data: CalendarView): Node[] {
  const week = (start?: string) => go({ name: 'calendar', ...(start ? { start } : {}) }, 'replace');
  const last = shift(data.start, data.days.length - 1);
  const range = `${dayLabel(data.start, false)} to ${dayLabel(last, false)}`;
  const nav = h('div', { className: 'pager' },
    h('button', { type: 'button', className: 'icon-button', 'aria-label': 'The week before', onClick: () => week(shift(data.start, -7)) }, icon(ICONS.back, 14)),
    data.start === data.today ? null : h('button', { type: 'button', className: 'button', onClick: () => week() }, 'Today'),
    h('button', { type: 'button', className: 'icon-button', 'aria-label': 'The week after', onClick: () => week(shift(data.start, 7)) }, icon(ICONS.next, 14)),
  );
  const status = data.status === 'no_providers'
    ? h('p', { className: 'note' }, 'No calendar is connected to Ri, so this shows deadlines only. Connect one in Ri’s Settings to see your events here.')
    : data.status === 'ok' ? null
      : h('p', { className: 'note' }, 'Ri couldn’t read every calendar just now, so some events may be missing.');
  return [
    h('header', { className: 'screen-head' }, h('h2', {}, range), nav),
    status,
    ...data.days.map(entry => day(entry, data.today)),
    footer(data.url),
  ].filter((node): node is HTMLElement => Boolean(node));
}

// ─── Notes and search ─────────────────────────────────────────

export function notes(data: NotesView): Node[] {
  const add = h('button', { type: 'button', className: 'button', onClick: () => go({ name: 'new-note' }) }, icon(ICONS.plus, 13), 'New note');
  const body = data.items.length ? h('ul', {}, ...data.items.map(noteRow)) : h('p', { className: 'empty' }, 'No notes yet.');
  return [section('Notes', data.items.length ? `${data.items.length}${data.more ? '+' : ''}` : null, add, body, data.more ? h('p', { className: 'note' }, 'Older notes are in Ri. Search finds them.') : null)];
}

export function search(data: SearchView): Node[] {
  if (!data.tasks.length && !data.notes.length) return [h('p', { className: 'empty' }, `Nothing in your tasks or notes matches “${data.query}”.`)];
  const list = `search:${data.query}`;
  return [
    data.tasks.length ? section('Tasks', String(data.tasks.length), null, h('ul', {}, ...data.tasks.map((task, index) => row(task, { list, index })))) : null,
    data.notes.length ? section('Notes', String(data.notes.length), null, h('ul', {}, ...data.notes.map(noteRow))) : null,
  ].filter((node): node is HTMLElement => Boolean(node));
}

// ─── The Stream ───────────────────────────────────────────────

/** Kept across draws, so a thought being typed survives a redraw. */
const captureField = field('Capture a thought', () => void capture(), () => { captureField.value = ''; });
let captureNote: string | null = null;
let capturing = false;

async function capture(): Promise<void> {
  const text = captureField.value.trim();
  if (!text || capturing) return;
  capturing = true;
  captureNote = null;
  redraw();
  const outcome = await act('create_stream_item', { rawText: text });
  capturing = false;
  if (outcome.ok) {
    captureField.value = '';
    captureNote = 'Captured. Rye will sort it into a task or note, or keep it as a thought.';
  } else {
    captureNote = outcome.message;
  }
  await reload();
  redraw();
}

function captureRow(item: ViewCapture): HTMLLIElement {
  const meta = dotted([
    h('span', {}, whenLabel(item.createdAt)),
    item.media === 'voice' ? h('span', { className: 'chip' }, 'Voice') : item.media === 'image' ? h('span', { className: 'chip' }, 'Photo') : null,
    item.proposed ? h('span', { className: 'chip' }, 'Rye has a suggestion') : null,
  ].filter((node): node is HTMLSpanElement => Boolean(node)));
  const text = item.cut ? `${item.text}…` : item.text;
  const when = new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return h('li', { className: 'row capture' },
    h('div', { className: 'body' },
      h('button', { type: 'button', className: 'capture-text', 'aria-expanded': 'false', onClick: toggleOpen }, text),
      h('div', { className: 'meta' }, ...meta),
      ...rowFeedback(item.id),
    ),
    draftButton('Add this thought to your message', () => void addToMessage(item.id, 'From my Stream', `A thought from my Ri Stream, captured ${when}:\n\n${text}`)),
  );
}

export function stream(data: StreamView): Node[] {
  return [
    h('div', { className: 'adder' }, captureField),
    captureNote ? h('p', { className: 'note', role: 'status' }, captureNote) : null,
    section('Stream', data.items.length ? `${data.items.length}${data.more ? '+' : ''}` : null, null,
      data.items.length ? h('ul', {}, ...data.items.map(captureRow)) : h('p', { className: 'empty' }, 'Nothing waiting. Everything captured has been sorted.'),
      data.more ? h('p', { className: 'note' }, 'More in Ri.') : null,
    ),
  ].filter((node): node is HTMLElement => Boolean(node));
}

export function clearCaptureNote(): void {
  captureNote = null;
}

// ─── The scratchpad ───────────────────────────────────────────

/**
 * One page, saved as the person writes. `base` is the text Ri last gave:
 * if another device wrote since, Ri merges the two, so neither loses
 * lines. Typing while a save is on its way saves again from what that save
 * sent, so Ri merges those words too.
 */
const pad = textArea('Write anything', 12, 'field area grow pad');
let base: string | null = null;
let saving = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let padStatus: 'saved' | 'saving' | 'merged' | 'failed' | null = null;

pad.addEventListener('input', () => {
  padStatus = null;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void savePad(), 800);
});
pad.addEventListener('blur', () => { if (dirty()) void savePad(); });

function dirty(): boolean {
  return base !== null && pad.value !== base;
}

async function savePad(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null; }
  if (base === null || !dirty()) return;
  if (saving) { again = true; return; }
  saving = true;
  padStatus = 'saving';
  redrawStatus();
  const sent = pad.value;
  try {
    const saved = await view<ScratchpadSaved>('save_scratchpad', { body: sent, base });
    if (pad.value === sent) {
      base = saved.body;
      if (saved.body !== sent) { pad.value = saved.body; fit(pad); }
    } else {
      // Words written since: the next save sends them against what this one sent.
      base = sent;
      again = true;
    }
    padStatus = saved.merged ? 'merged' : 'saved';
  } catch {
    padStatus = 'failed';
  }
  saving = false;
  redrawStatus();
  if (again) { again = false; void savePad(); }
}

const STATUS_TEXT = { saved: 'Saved', saving: 'Saving', merged: 'Saved, with another device’s changes merged in', failed: 'Couldn’t save. It will try again as you write.' } as const;

const statusLine = h('span', { className: 'section-meta', role: 'status' });

function redrawStatus(): void {
  statusLine.textContent = padStatus ? STATUS_TEXT[padStatus] : '';
  statusLine.classList.toggle('tone-danger', padStatus === 'failed');
}

hooks.leaving.push(() => { if (dirty()) void savePad(); });

function padMessage(): void {
  const selected = pad.value.slice(pad.selectionStart, pad.selectionEnd).trim();
  const text = (selected || pad.value.trim()).slice(0, 32 * 1024);
  if (!text) return;
  void addToMessage('scratchpad', 'From my scratchpad', `From my Ri scratchpad:\n\n${text}`);
}

export function scratchpad(data: ScratchpadView): Node[] {
  // Ri's text replaces the page only when nothing written here is waiting to save.
  if (!dirty() && !saving) {
    base = data.body;
    if (pad.value !== data.body) pad.value = data.body;
  }
  redrawStatus();
  const add = state.bridge?.canDraft
    ? h('button', { type: 'button', className: 'button', onClick: padMessage }, icon(ICONS.addToMessage, 13), 'Add to message')
    : null;
  return [
    h('header', { className: 'screen-head' }, h('h2', {}, 'Scratchpad'), statusLine, add ? h('span', { className: 'aside' }, add) : null),
    pad,
    ...rowFeedback('scratchpad'),
    h('p', { className: 'note' }, state.bridge?.canDraft ? 'The same page as in Ri. Select some of it to add just that to your message.' : 'The same page as in Ri.'),
  ];
}

/** Saves what's waiting before the view goes away. */
export async function flushScratchpad(): Promise<void> {
  if (dirty()) await savePad();
}

// ─── Search, from the app's header ────────────────────────────

export const searchField = field('Search tasks and notes', () => runSearch(), () => {
  searchField.value = '';
  if (current().name === 'search') back();
});

function runSearch(): void {
  const query = searchField.value.trim();
  if (!query) return;
  go({ name: 'search', query }, current().name === 'search' ? 'replace' : 'push');
  tell(`In the Ri app, the person searched their tasks and notes for "${query}".`);
}
