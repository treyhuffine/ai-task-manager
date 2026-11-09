/**
 * Tasks in Ri's view: the row every list shares, the changes a row makes,
 * today's deck, the task list and the board. The deck follows its own
 * grammar (docs/deck-layout.md): deadlines pinned on top, a flat ranked
 * stack, status as quiet chips, the deck's reasoning as one-line glimpses.
 * Browser code: bundled into the view by `pnpm mcp-views:build`.
 */
import type { DeckView, TasksView, ViewTask } from '../data';
import type { BoardColumn, BoardView, ViewNote } from '../screens';
import { act, current, dayLabel, idempotencyKey, isApp, kept, locale, localDay, open, openItem, redraw, reload, state, tell, whenLabel, withKept } from './core';
import { dotted, field, h, icon, ICONS, type Child } from './dom';

/** Tasks with a change on its way, so a double tap can't send two. */
const pending = new Set<string>();
/** A row's last error, shown under it until the next change. */
const rowErrors = new Map<string, string>();
/** A row's last confirmation, such as "Added to your message". */
const rowNotes = new Map<string, string>();

export type Command = 'move_to_todo' | 'move_to_consider' | 'start' | 'return_to_todo' | 'complete' | 'reopen' | 'archive' | 'restore';

/** Where each command takes a task, the same matrix as Ri's (`src/lib/tasks/lifecycle.ts`). */
export const COMMANDS: Record<Command, { from: ReadonlyArray<ViewTask['status']>; to: ViewTask['status']; label: string; done: string }> = {
  move_to_todo: { from: ['consider'], to: 'todo', label: 'Move to Todo', done: 'moved to Todo' },
  move_to_consider: { from: ['todo'], to: 'consider', label: 'Move to Consider', done: 'moved to Consider' },
  start: { from: ['consider', 'todo'], to: 'in_progress', label: 'Start', done: 'started' },
  return_to_todo: { from: ['in_progress'], to: 'todo', label: 'Return to Todo', done: 'returned to Todo' },
  complete: { from: ['todo', 'in_progress'], to: 'done', label: 'Mark done', done: 'marked done' },
  reopen: { from: ['done'], to: 'todo', label: 'Reopen', done: 'reopened' },
  archive: { from: ['consider', 'todo', 'in_progress'], to: 'archived', label: 'Archive', done: 'archived' },
  restore: { from: ['archived'], to: 'todo', label: 'Restore', done: 'restored' },
};

export const STATUS_LABEL: Record<ViewTask['status'], string> = { consider: 'Consider', todo: 'Todo', in_progress: 'In progress', done: 'Done', archived: 'Archived' };

/** A repeating task finished for now: it looks done, with nothing to press until its next date. */
export function restingUntil(task: ViewTask): string | null {
  return task.nextOccurrence ? new Date(task.nextOccurrence).toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric' }) : null;
}

export function isFinished(task: ViewTask): boolean {
  return task.status === 'done' || task.nextOccurrence !== null;
}

export function isBusy(task: ViewTask): boolean {
  return pending.has(task.id);
}

function deadlineLabel(task: ViewTask): { text: string; tone: 'danger' | 'warning' | 'quiet' } | null {
  if (!task.deadline || task.daysUntil === null) return null;
  if (task.daysUntil < 0) return { text: `Overdue ${-task.daysUntil} ${task.daysUntil === -1 ? 'day' : 'days'}`, tone: 'danger' };
  if (task.daysUntil === 0) return { text: 'Due today', tone: 'warning' };
  if (task.daysUntil === 1) return { text: 'Due tomorrow', tone: 'warning' };
  if (task.daysUntil < 7) return { text: `Due ${localDay(task.deadline).toLocaleDateString(locale(), { weekday: 'long' })}`, tone: 'quiet' };
  return { text: `Due ${dayLabel(task.deadline, false)}`, tone: 'quiet' };
}

/** A task's quiet facts: its status when that's news, area, deadline, blocked, repeating. */
export function taskMeta(task: ViewTask, options: { status?: boolean } = {}): Node[] {
  const next = restingUntil(task);
  const done = isFinished(task);
  const deadline = deadlineLabel(task);
  const meta: Child[] = [];
  if (options.status !== false) {
    if (task.status === 'in_progress') meta.push(h('span', { className: 'chip' }, 'In progress'));
    if (task.status === 'consider') meta.push(h('span', { className: 'chip' }, 'Considering'));
    if (task.status === 'archived') meta.push(h('span', { className: 'chip' }, 'Archived'));
  }
  if (task.blocked && !done) meta.push(h('span', { className: 'chip' }, 'Blocked'));
  if (task.area) meta.push(h('span', {}, task.area));
  if (deadline && !done) meta.push(h('span', { className: `tone-${deadline.tone}` }, deadline.text));
  if (next) meta.push(h('span', {}, `Next ${next}`));
  else if (task.recurring) meta.push(h('span', {}, 'Repeats'));
  return dotted(meta.filter((node): node is Node => Boolean(node)));
}

// ─── Changes ──────────────────────────────────────────────────

/**
 * Changes a task's status through Ri's own tools, with the count the view
 * drew, so a view that's out of date is refused rather than undoing newer
 * work. It shows at once, then what Ri answered, then Ri's redraw. The row
 * stays busy until the redraw lands, so a quick second tap never sends the
 * count from before this change.
 */
export async function change(task: ViewTask, command: Command, where?: { list: string; index: number }): Promise<void> {
  if (!state.bridge || pending.has(task.id)) return;
  pending.add(task.id);
  rowErrors.delete(task.id);
  rowNotes.delete(task.id);
  const before = task.status;
  task.status = COMMANDS[command].to;
  redraw();
  const base = { id: task.id, idempotency_key: idempotencyKey(), expected_status_changed_count: task.statusChangedCount };
  const outcome = command === 'complete' ? await act('complete_task', base) : await act('transition_task', { ...base, command });
  if (!outcome.ok) {
    task.status = before;
    rowErrors.set(task.id, refusal(command, outcome.code, outcome.details !== undefined, outcome.message));
  } else {
    // Good even if the redraw below fails: a repeating task's next date, and the count the next change needs.
    const result = (outcome.result ?? {}) as { toStatus?: ViewTask['status']; statusChangedCount?: number; nextRecurrenceAt?: string | null };
    if (result.toStatus) task.status = result.toStatus;
    if (typeof result.statusChangedCount === 'number') task.statusChangedCount = result.statusChangedCount;
    if (result.nextRecurrenceAt) task.nextOccurrence = result.nextRecurrenceAt;
    if (isFinished(task) && where) kept.set(task.id, { task, ...where });
    else kept.delete(task.id);
    tell(`In the Ri app, the person ${COMMANDS[command].done} the task "${task.title}" (${task.id}).`);
  }
  redraw();
  await reload();
  pending.delete(task.id);
  redraw();
}

/** A refused change in words a person can act on. Ri's own words name parameters only an agent can pass. */
function refusal(command: Command, code: string | null, detailed: boolean, message: string): string {
  if (code !== 'conflict') return message;
  if (!detailed) return 'This task changed in Ri, so that didn’t go through.';
  if (command === 'archive') return 'This task has open subtasks or an agent working on it. Archive it in Ri, where you can choose what happens to them.';
  return 'An agent is working on this task. Change it in Ri, where you can choose whether to stop the agent.';
}

/** Puts something in the message the person is writing, as a labeled item they can remove. Nothing is sent. */
export async function addToMessage(rowId: string, title: string, text: string): Promise<void> {
  if (!state.bridge?.canDraft) return;
  rowErrors.delete(rowId);
  try {
    await state.bridge.addToMessage(title, text);
    rowNotes.set(rowId, 'Added to your message.');
  } catch {
    rowErrors.set(rowId, 'Couldn’t add it to your message.');
  }
  redraw();
}

export function taskMessage(task: ViewTask): string {
  const facts = [STATUS_LABEL[task.status].toLowerCase(), task.area, task.deadline ? `due ${task.deadline}` : null].filter(Boolean).join(', ');
  return `Ri task "${task.title}" (${facts}). Its ID is ${task.id}: read it with get_task.`;
}

export function draftButton(label: string, onClick: () => void): HTMLButtonElement | null {
  return state.bridge?.canDraft
    ? h('button', { type: 'button', className: 'draft', 'aria-label': label, onClick }, icon(ICONS.addToMessage, 14))
    : null;
}

export function rowFeedback(id: string): Node[] {
  const error = rowErrors.get(id);
  const note = rowNotes.get(id);
  if (error) return [h('p', { className: 'row-error', role: 'alert' }, error)];
  if (note) return [h('p', { className: 'row-note', role: 'status' }, note)];
  return [];
}

export function setRowError(id: string, message: string | null): void {
  if (message) rowErrors.set(id, message); else rowErrors.delete(id);
}

// ─── The row ──────────────────────────────────────────────────

export function checkButton(task: ViewTask, where?: { list: string; index: number }): HTMLButtonElement {
  const next = restingUntil(task);
  const done = isFinished(task);
  return h('button', {
    type: 'button', className: 'check', disabled: isBusy(task) || next !== null || task.status === 'archived',
    'aria-pressed': String(done), 'aria-label': next ? `${task.title} is done until ${next}` : done ? `Reopen ${task.title}` : `Mark ${task.title} done`,
    onClick: () => void change(task, done ? 'reopen' : 'complete', where),
  }, done ? icon(ICONS.check, 12) : null);
}

export function row(task: ViewTask, options: { reason?: boolean; list?: string; index?: number } = {}): HTMLLIElement {
  const done = isFinished(task);
  const where = options.list !== undefined ? { list: options.list, index: options.index ?? 0 } : undefined;
  const reason = options.reason && task.reason && !done
    ? h('button', { type: 'button', className: 'reason', 'aria-expanded': 'false', onClick: toggleOpen }, task.reason)
    : null;
  const start = !done && (task.status === 'todo' || task.status === 'consider')
    ? h('button', { type: 'button', className: 'start', disabled: isBusy(task), 'aria-label': `Start ${task.title}`, onClick: () => void change(task, 'start', where) }, 'Start')
    : null;
  const meta = taskMeta(task);
  return h('li', { className: `row${done ? ' done' : ''}${isBusy(task) ? ' busy' : ''}`, 'data-task': task.id },
    checkButton(task, where),
    h('div', { className: 'body' },
      h('button', { type: 'button', className: 'title link', onClick: () => openItem('task', task.id) }, h('span', { className: 'title-text' }, task.title)),
      meta.length ? h('div', { className: 'meta' }, ...meta) : null,
      reason,
      ...rowFeedback(task.id),
    ),
    start,
    draftButton(`Add ${task.title} to your message`, () => void addToMessage(task.id, task.title, taskMessage(task))),
  );
}

export function noteRow(note: ViewNote): HTMLLIElement {
  const meta = dotted([
    note.kind === 'decision' ? h('span', { className: 'chip' }, 'Decision') : null,
    note.area ? h('span', {}, note.area) : null,
    h('span', {}, whenLabel(note.updatedAt)),
  ].filter((node): node is HTMLSpanElement => Boolean(node)));
  return h('li', { className: 'row note-row', 'data-note': note.id },
    h('div', { className: 'body' },
      h('button', { type: 'button', className: 'title link', onClick: () => openItem('note', note.id) }, h('span', { className: 'title-text' }, note.title)),
      note.excerpt ? h('p', { className: 'excerpt' }, note.excerpt) : null,
      h('div', { className: 'meta' }, ...meta),
      ...rowFeedback(note.id),
    ),
    draftButton(`Add ${note.title} to your message`, () => void addToMessage(note.id, note.title, `Ri ${note.kind} "${note.title}". Its ID is ${note.id}: read it with get_note.`)),
  );
}

export function toggleOpen(event: Event): void {
  const target = event.currentTarget as HTMLElement;
  target.setAttribute('aria-expanded', String(target.classList.toggle('open')));
}

export function section(label: string, meta: Child, aside: Child, ...body: Child[]): HTMLElement {
  return h('section', {},
    h('header', { className: 'section-head' }, h('h2', {}, label), meta ? h('span', { className: 'section-meta' }, meta) : null, aside ? h('span', { className: 'aside' }, aside) : null),
    ...body,
  );
}

export function footer(url: string | null): HTMLElement | null {
  return url && !isApp() ? h('footer', {}, h('button', { type: 'button', className: 'open-ri', onClick: () => open(url) }, 'Open Ri', icon(ICONS.open, 12))) : null;
}

// ─── Adding a task ────────────────────────────────────────────

/** Kept across draws, so what's being typed survives a change landing. */
export const addField = field('Add a task', () => void addTask(), () => { addField.value = ''; });
let addNote: string | null = null;
let adding = false;

async function addTask(): Promise<void> {
  const title = addField.value.trim();
  if (!title || adding) return;
  adding = true;
  addNote = null;
  const outcome = await act<{ id: string }>('create_task', { title });
  if (outcome.ok) {
    addField.value = '';
    addNote = `Added “${title}” to your tasks.`;
    tell(`In the Ri app, the person added the task "${title}" (${outcome.result?.id ?? 'new'}).`);
  } else {
    addNote = outcome.message;
  }
  adding = false;
  await reload();
  redraw();
}

function adder(): Node[] {
  if (!isApp()) return [];
  const nodes: Node[] = [h('div', { className: 'adder' }, addField)];
  if (addNote) nodes.push(h('p', { className: 'note', role: 'status' }, addNote));
  return nodes;
}

export function clearAddNote(): void {
  addNote = null;
}

// ─── Today and Tasks ──────────────────────────────────────────

export function deck(data: DeckView): Node[] {
  const nodes: Node[] = [...adder()];
  if (data.deadlines.length) {
    nodes.push(section('Deadlines', String(data.deadlines.length), null, h('ul', {}, ...data.deadlines.map(task => row(task)))));
  }
  const label = data.isToday || !data.forDate ? 'Today' : 'Deck';
  const meta = data.forDate ? dayLabel(data.forDate) : null;
  const aside = data.inProgress ? h('span', { className: 'chip' }, `${data.inProgress} in progress`) : null;
  const old = data.forDate && !data.isToday ? h('p', { className: 'note' }, `This is the deck for ${dayLabel(data.forDate)}. Today’s isn’t made yet.`) : null;
  const framing = data.framing ? h('button', { type: 'button', className: 'reason framing', 'aria-expanded': 'false', onClick: toggleOpen }, data.framing) : null;
  const body = data.items.length
    ? h('ol', {}, ...data.items.map(task => row(task, { reason: true })))
    : h('p', { className: 'empty' }, data.forDate ? 'Nothing is on this deck.' : 'There’s no deck yet. Ri makes one each morning, or open Ri to make one now.');
  nodes.push(section(label, meta, aside, old, framing, body));
  const end = footer(data.url);
  if (end) nodes.push(end);
  return nodes;
}

export function tasks(data: TasksView): Node[] {
  const list = `tasks:${JSON.stringify(current())}`;
  const items = withKept(list, data.items);
  const more = data.more ? h('p', { className: 'note' }, 'More in Ri.') : null;
  const body = items.length ? h('ul', {}, ...items.map((task, index) => row(task, { list, index }))) : h('p', { className: 'empty' }, 'No tasks match.');
  const nodes: Node[] = [...adder(), section(data.title, items.length ? `${data.items.length}${data.more ? '+' : ''}` : null, null, body, more)];
  const end = footer(data.url);
  if (end) nodes.push(end);
  return nodes;
}

// ─── The board ────────────────────────────────────────────────

const COLUMN_LABEL: Record<BoardColumn['status'], string> = { consider: 'Consider', todo: 'Todo', in_progress: 'In progress' };
const ORDER: BoardColumn['status'][] = ['consider', 'todo', 'in_progress'];

/** The command that moves a task from one column to another, if Ri has one. In progress goes back through Todo. */
export function moveCommand(from: ViewTask['status'], to: BoardColumn['status']): Command | null {
  if (from === to) return null;
  if (to === 'in_progress') return from === 'consider' || from === 'todo' ? 'start' : null;
  if (to === 'todo') return from === 'consider' ? 'move_to_todo' : from === 'in_progress' ? 'return_to_todo' : null;
  return from === 'todo' ? 'move_to_consider' : null;
}

/** The column a card was loaded in, so a card just finished stays there, ticked, rather than jumping. */
const homeColumn = new WeakMap<ViewTask, BoardColumn['status']>();
let dragging: ViewTask | null = null;

function card(task: ViewTask, column: BoardColumn['status'], index: number): HTMLLIElement {
  const done = isFinished(task) || task.status === 'archived';
  const where = { list: `board:${column}`, index };
  const at = ORDER.indexOf(column);
  const left = at > 0 && !done ? moveCommand(task.status, ORDER[at - 1]) : null;
  const right = at < ORDER.length - 1 && !done ? moveCommand(task.status, ORDER[at + 1]) : null;
  const meta = taskMeta(task, { status: false });
  const element = h('li', { className: `card${done ? ' done' : ''}${isBusy(task) ? ' busy' : ''}`, draggable: done ? undefined : 'true', 'data-task': task.id },
    h('div', { className: 'card-top' },
      checkButton(task, where),
      h('button', { type: 'button', className: 'title link', onClick: () => openItem('task', task.id) }, h('span', { className: 'title-text' }, task.title)),
      // The arrows sit beside the title, so a card is only as tall as what it says.
      left || right ? h('span', { className: 'moves' },
        left ? h('button', { type: 'button', className: 'move', disabled: isBusy(task), 'aria-label': `Move ${task.title} to ${COLUMN_LABEL[ORDER[at - 1]]}`, onClick: () => void change(task, left, where) }, icon(ICONS.back, 14)) : null,
        right ? h('button', { type: 'button', className: 'move', disabled: isBusy(task), 'aria-label': `Move ${task.title} to ${COLUMN_LABEL[ORDER[at + 1]]}`, onClick: () => void change(task, right, where) }, icon(ICONS.next, 14)) : null,
      ) : null,
    ),
    meta.length ? h('div', { className: 'meta' }, ...meta) : null,
    ...rowFeedback(task.id),
  );
  element.addEventListener('dragstart', event => {
    dragging = task;
    event.dataTransfer?.setData('text/plain', task.title);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    element.classList.add('dragging');
  });
  element.addEventListener('dragend', () => {
    dragging = null;
    element.classList.remove('dragging');
    document.querySelectorAll('.column.drop').forEach(node => node.classList.remove('drop'));
  });
  return element;
}

export function board(data: BoardView): Node[] {
  const all: ViewTask[] = [];
  for (const column of data.columns) {
    for (const task of column.items) {
      if (!homeColumn.has(task)) homeColumn.set(task, column.status);
      all.push(task);
    }
  }
  const columns = data.columns.map(column => {
    const list = `board:${column.status}`;
    // A card moved here shows here at once, before Ri's redraw.
    const items = withKept(list, all.filter(task => (ORDER.includes(task.status as BoardColumn['status']) ? task.status : homeColumn.get(task)) === column.status));
    const element = h('section', { className: 'column', 'aria-label': COLUMN_LABEL[column.status] },
      h('header', { className: 'column-head' }, h('h2', {}, COLUMN_LABEL[column.status]), h('span', { className: 'section-meta' }, `${items.length}${column.more ? '+' : ''}`)),
      items.length ? h('ul', { className: 'cards' }, ...items.map((task, index) => card(task, column.status, index))) : h('p', { className: 'empty' }, 'Nothing here.'),
      column.more ? h('p', { className: 'note' }, 'More in Ri.') : null,
    );
    element.addEventListener('dragover', event => {
      if (!dragging || !moveCommand(dragging.status, column.status)) return;
      event.preventDefault();
      element.classList.add('drop');
    });
    element.addEventListener('dragleave', event => {
      if (!element.contains(event.relatedTarget as Node | null)) element.classList.remove('drop');
    });
    element.addEventListener('drop', event => {
      event.preventDefault();
      element.classList.remove('drop');
      const task = dragging;
      const command = task ? moveCommand(task.status, column.status) : null;
      if (task && command) void change(task, command, { list, index: items.length });
    });
    return element;
  });
  return [h('div', { className: 'board' }, ...columns)];
}
