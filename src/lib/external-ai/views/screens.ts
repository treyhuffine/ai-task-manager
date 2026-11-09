/**
 * The rest of Ri's app inside an outside assistant (docs/mcp-oauth.md,
 * "The app"): the board, the calendar, notes, search, one task or note in
 * full, the Stream and the scratchpad. Only the view reads these, through
 * `load_view`, which hosts keep from their model (`ui.visibility: ['app']`).
 * Changes go through the ordinary content tools, so every guard that holds
 * for an assistant holds here too. The scratchpad's own save is the one
 * exception, since no content tool writes it.
 */
import { getCalendarRange } from '@/lib/calendar/service';
import type { CalendarEvent, CalendarReadStatus } from '@/lib/calendar/types';
import { todayLocalDate } from '@/lib/deck/date';
import { getNote, getScratchpad, getTask, listNotes, listStream, listTasks, saveScratchpad } from '@/lib/db/queries';
import { hybridSearch } from '@/lib/embeddings/search';
import { isTeamAuthority } from '@/lib/home/authority';
import type { NoteRecord, StreamRecord, TaskRecord } from '@/db/types';
import { areaNames, openBase, viewTask, type ViewTask } from './data';

export const VIEW_SCREENS = ['board', 'calendar', 'notes', 'search', 'item', 'stream', 'scratchpad'] as const;
export type ViewScreen = (typeof VIEW_SCREENS)[number];

/** A column, a list of notes or the Stream shows this many, and says when there are more. */
export const SCREEN_LIMIT = 50;
/** One item's body as the view receives it. Ri keeps the rest. */
export const ITEM_BODY_MAX = 200 * 1024;
/** One capture as the Stream screen shows it. */
const CAPTURE_TEXT_MAX = 4000;
export const CALENDAR_DAYS = 7;
/** The scratchpad is one page, written by hand. */
export const SCRATCHPAD_MAX = 512 * 1024;

export interface ViewNote {
  id: string;
  title: string;
  /** No title of its own: `title` is its first line. */
  untitled: boolean;
  /** The start of its text, markdown taken out. */
  excerpt: string;
  kind: 'note' | 'decision';
  area: string | null;
  updatedAt: string;
  url: string | null;
}

export interface BoardColumn {
  status: 'consider' | 'todo' | 'in_progress';
  items: ViewTask[];
  more: boolean;
}

export interface BoardView { screen: 'board'; columns: BoardColumn[]; url: string | null }

export interface ViewEvent {
  id: string;
  title: string;
  /** An instant for a timed event, `YYYY-MM-DD` for an all-day one. */
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  joinUrl: string | null;
  sourceUrl: string | null;
  color: string | null;
  declined: boolean;
}

export interface CalendarDayView {
  date: string;
  allDay: ViewEvent[];
  events: ViewEvent[];
  /** Todo and In progress tasks due this day, as Ri's own calendar shows them. */
  deadlines: ViewTask[];
}

export interface CalendarView {
  screen: 'calendar';
  start: string;
  today: string;
  /** `no_providers` when no calendar is connected: the deadlines still show. */
  status: CalendarReadStatus;
  days: CalendarDayView[];
  url: string | null;
}

export interface NotesView { screen: 'notes'; items: ViewNote[]; more: boolean; url: string | null }

export interface SearchView { screen: 'search'; query: string; tasks: ViewTask[]; notes: ViewNote[] }

/** `[[task:id]]` and `[[note:id]]` in a body, by id, so the view can draw them as links with titles. */
export type LinkTitles = Record<string, { type: 'task' | 'note'; title: string }>;

export interface TaskItem extends ViewTask {
  outcome: string | null;
  body: string;
  /** Sent back with a body edit, so newer text is never replaced. */
  bodyRevision: number;
  /** Shared with a team: its title, outcome and body are the team's. */
  team: boolean;
  parent: { id: string; title: string } | null;
}

export interface NoteItem extends ViewNote {
  body: string;
  bodyRevision: number;
  team: boolean;
  status: NoteRecord['status'];
  task: { id: string; title: string } | null;
}

export type ItemView =
  | { screen: 'item'; type: 'task'; task: TaskItem; subtasks: ViewTask[]; notes: ViewNote[]; links: LinkTitles }
  | { screen: 'item'; type: 'note'; note: NoteItem; links: LinkTitles }
  | { screen: 'item'; type: 'task' | 'note'; missing: true; id: string };

export interface ViewCapture {
  id: string;
  text: string;
  /** The capture is longer than `text`. */
  cut: boolean;
  createdAt: string;
  media: StreamRecord['media'];
  /** Rye has suggested what to do with it, waiting on the person. */
  proposed: boolean;
}

export interface StreamView { screen: 'stream'; items: ViewCapture[]; more: boolean; url: string | null }

export interface ScratchpadView { screen: 'scratchpad'; body: string; updatedAt: string | null; url: string | null }

export type ScreenView = BoardView | CalendarView | NotesView | SearchView | ItemView | StreamView | ScratchpadView;

export interface ScreenInput {
  screen: ViewScreen;
  /** Calendar: the first day, `YYYY-MM-DD`. Today when left out. */
  start?: string;
  /** Search. */
  query?: string;
  /** Item. */
  type?: 'task' | 'note';
  id?: string;
}

// ─── Shapes ───────────────────────────────────────────────────

function plain(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[\[(task|note|file):[^\]]*\]\]/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]\s+\[[ xX]\]|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function noteTitle(note: Pick<NoteRecord, 'title' | 'body'>): { title: string; untitled: boolean } {
  const own = note.title?.trim();
  if (own) return { title: own, untitled: false };
  const first = plain(note.body.split('\n').find(line => line.trim()) ?? '').slice(0, 80);
  return { title: first || 'Untitled note', untitled: true };
}

function viewNote(note: NoteRecord, areas: Map<string, string>, base: string | null): ViewNote {
  const { title, untitled } = noteTitle(note);
  const text = plain(note.body);
  return {
    id: note.id,
    title,
    untitled,
    excerpt: (untitled && text.startsWith(title) ? text.slice(title.length).trim() : text).slice(0, 160),
    kind: note.kind === 'decision' ? 'decision' : 'note',
    area: note.areaId ? areas.get(note.areaId) ?? null : null,
    updatedAt: note.updatedAt,
    url: base ? `${base}/note/${encodeURIComponent(note.id)}` : null,
  };
}

function viewEvent(event: CalendarEvent): ViewEvent {
  return {
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    location: event.location,
    joinUrl: event.joinUrl,
    sourceUrl: event.sourceUrl,
    color: event.color,
    declined: event.rsvp === 'declined',
  };
}

/** Titles for the task and note links in a body. A link to another Home has a slash and stays as written. */
function linkTitles(body: string): LinkTitles {
  const links: LinkTitles = {};
  for (const [, type, id] of body.matchAll(/\[\[(task|note):([^\]/|]+)\]\]/g)) {
    if (links[id]) continue;
    if (type === 'task') {
      const task = getTask(id);
      if (task) links[id] = { type, title: task.title };
    } else {
      const note = getNote(id);
      if (note) links[id] = { type: 'note', title: noteTitle(note).title };
    }
  }
  return links;
}

function cap(body: string): string {
  return body.length > ITEM_BODY_MAX ? `${body.slice(0, ITEM_BODY_MAX)}\n\n…` : body;
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return todayLocalDate(new Date(year, month - 1, day + days));
}

// ─── Screens ──────────────────────────────────────────────────

function board(now: Date): BoardView {
  const areas = areaNames();
  const base = openBase();
  const columns = (['consider', 'todo', 'in_progress'] as const).map(status => {
    const found = listTasks({ status, limit: SCREEN_LIMIT + 1 });
    return { status, items: found.slice(0, SCREEN_LIMIT).map(task => viewTask(task, areas, base, null, now)), more: found.length > SCREEN_LIMIT };
  });
  return { screen: 'board', columns, url: base ? `${base}/` : null };
}

async function calendar(input: ScreenInput, now: Date): Promise<CalendarView> {
  const today = todayLocalDate(now);
  const start = input.start && /^\d{4}-\d{2}-\d{2}$/.test(input.start) ? input.start : today;
  const dates = Array.from({ length: CALENDAR_DAYS }, (_, index) => addDays(start, index));
  const areas = areaNames();
  const base = openBase();
  const range = await getCalendarRange({ start, days: CALENDAR_DAYS });
  const byDate = new Map(range.days.map(day => [day.date, day]));
  // The commitment calendar shows Todo and In progress deadlines, as Ri's own does. Consider stays off it.
  const due = new Map<string, ViewTask[]>();
  for (const task of listTasks({ status: ['todo', 'in_progress'], orderBy: 'hardDeadline' })) {
    const date = task.hardDeadline?.slice(0, 10);
    if (!date || date < dates[0] || date > dates[dates.length - 1]) continue;
    due.set(date, [...(due.get(date) ?? []), viewTask(task, areas, base, null, now)]);
  }
  return {
    screen: 'calendar',
    start,
    today,
    status: range.status,
    days: dates.map(date => ({
      date,
      allDay: (byDate.get(date)?.allDay ?? []).map(viewEvent),
      events: (byDate.get(date)?.events ?? []).map(viewEvent),
      deadlines: due.get(date) ?? [],
    })),
    url: base ? `${base}/?calendar=1` : null,
  };
}

function notes(): NotesView {
  const areas = areaNames();
  const base = openBase();
  const found = listNotes({ status: 'active', orderBy: 'updatedAt', limit: SCREEN_LIMIT + 1 });
  return { screen: 'notes', items: found.slice(0, SCREEN_LIMIT).map(note => viewNote(note, areas, base)), more: found.length > SCREEN_LIMIT, url: base ? `${base}/` : null };
}

/** Tasks and notes by meaning and words, as Ri's own search finds them. Never the Stream. */
async function search(query: string, now: Date): Promise<SearchView> {
  const q = query.trim().slice(0, 200);
  if (!q) return { screen: 'search', query: '', tasks: [], notes: [] };
  const areas = areaNames();
  const base = openBase();
  const hits = await hybridSearch(q, { limit: 30, includeStream: false });
  const tasks: ViewTask[] = [];
  const found: ViewNote[] = [];
  for (const hit of hits) {
    if (hit.entityType === 'task') {
      const task = getTask(hit.entityId);
      if (task) tasks.push(viewTask(task, areas, base, null, now));
    } else if (hit.entityType === 'note') {
      const note = getNote(hit.entityId);
      if (note && note.status !== 'archived') found.push(viewNote(note, areas, base));
    }
  }
  return { screen: 'search', query: q, tasks, notes: found };
}

function item(type: 'task' | 'note', id: string, now: Date): ItemView {
  const areas = areaNames();
  const base = openBase();
  if (type === 'task') {
    const task = getTask(id);
    if (!task) return { screen: 'item', type, missing: true, id };
    const parent = task.parentId ? getTask(task.parentId) : null;
    const body = task.body ?? '';
    return {
      screen: 'item',
      type,
      task: {
        ...viewTask(task, areas, base, null, now),
        outcome: task.outcome ?? null,
        body: cap(body),
        bodyRevision: (task.sourceTeamId ? task.source?.bodyRevision : undefined) ?? task.bodyRevision,
        team: Boolean(task.sourceTeamId),
        parent: parent ? { id: parent.id, title: parent.title } : null,
      },
      subtasks: listTasks({ parentId: task.id, limit: 200 })
        .filter((child: TaskRecord) => child.status !== 'archived')
        .map(child => viewTask(child, areas, base, null, now)),
      notes: listNotes({ taskId: task.id, status: 'active', orderBy: 'updatedAt', limit: 20 }).map(note => viewNote(note, areas, base)),
      links: linkTitles(body),
    };
  }
  const note = getNote(id);
  if (!note) return { screen: 'item', type, missing: true, id };
  const task = note.taskId ? getTask(note.taskId) : null;
  return {
    screen: 'item',
    type,
    note: {
      ...viewNote(note, areas, base),
      body: cap(note.body),
      bodyRevision: (note.sourceTeamId ? note.source?.bodyRevision : undefined) ?? note.bodyRevision,
      team: Boolean(note.sourceTeamId),
      status: note.status,
      task: task ? { id: task.id, title: task.title } : null,
    },
    links: linkTitles(note.body),
  };
}

/** What waits for triage: new captures, and ones Rye has a suggestion for. Newest first. */
function stream(): StreamView {
  const base = openBase();
  const found = listStream({ status: ['pending', 'proposed'], limit: SCREEN_LIMIT + 1 });
  return {
    screen: 'stream',
    items: found.slice(0, SCREEN_LIMIT).map(capture => ({
      id: capture.id,
      text: capture.rawText.slice(0, CAPTURE_TEXT_MAX),
      cut: capture.rawText.length > CAPTURE_TEXT_MAX,
      createdAt: capture.createdAt,
      media: capture.media,
      proposed: capture.status === 'proposed',
    })),
    more: found.length > SCREEN_LIMIT,
    url: base ? `${base}/` : null,
  };
}

function scratchpad(): ScratchpadView {
  const pad = getScratchpad();
  const base = openBase();
  return { screen: 'scratchpad', body: pad?.body ?? '', updatedAt: pad?.updatedAt ?? null, url: base ? `${base}/` : null };
}

/** One screen of the app, as `load_view` returns it. */
export async function screenView(input: ScreenInput, now = new Date()): Promise<ScreenView> {
  switch (input.screen) {
    case 'board': return board(now);
    case 'calendar': return calendar(input, now);
    case 'notes': return notes();
    case 'search': return search(input.query ?? '', now);
    case 'item': return item(input.type === 'note' ? 'note' : 'task', input.id ?? '', now);
    case 'stream': return stream();
    case 'scratchpad':
      if (isTeamAuthority()) throw new Error('A team has no scratchpad. It lives in your own Ri.');
      return scratchpad();
  }
}

export interface ScratchpadSaved { body: string; merged: boolean; updatedAt: string }

/**
 * Saves what the person wrote in the view. `base` is the text the view last
 * had from Ri: if another device wrote since, the two are merged, so neither
 * loses lines, and the view shows the merged text (docs/scratchpad.md).
 */
export function saveScratchpadFromView(body: string, base: string): ScratchpadSaved {
  if (isTeamAuthority()) throw new Error('A team has no scratchpad. It lives in your own Ri.');
  const saved = saveScratchpad(body, base);
  return { body: saved.record.body, merged: saved.merged, updatedAt: saved.record.updatedAt };
}
