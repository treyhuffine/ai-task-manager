/**
 * One task or note in full, inside the assistant: read it, change it, and
 * for a task its subtasks and notes. Opening one tells the model which it
 * is, so "help me with this" beside a chat knows what "this" means. Edits go
 * through `update_task` and `update_note` with the body revision the view
 * drew, so newer text in Ri is never replaced unseen.
 * Browser code: bundled into the view by `pnpm mcp-views:build`.
 */
import type { ItemView, LinkTitles, NoteItem, TaskItem } from '../screens';
import { act, back, go, open, openItem, redraw, reload, state, tellItem, whenLabel } from './core';
import { dotted, field, h, icon, ICONS, textArea } from './dom';
import { markdown } from './markdown';
import { addToMessage, change, checkButton, COMMANDS, isBusy, isFinished, noteRow, row, rowFeedback, section, STATUS_LABEL, taskMessage, taskMeta, type Command } from './tasks';

interface Draft {
  type: 'task' | 'note';
  /** Null for a new note. */
  id: string | null;
  title: HTMLInputElement;
  outcome: HTMLTextAreaElement | null;
  body: HTMLTextAreaElement;
  /** What the fields held when editing began, so only what changed is sent. */
  from: { title: string; outcome: string; body: string };
  revision: number | null;
  saving: boolean;
  error: string | null;
  /** Ri's text moved on while this was being written: saving again replaces it. */
  conflict: boolean;
}

/** The item being edited, kept across draws so typing survives a change landing. */
let draft: Draft | null = null;
/** The last item told to the model, so a redraw doesn't tell it again. */
let told: string | null = null;

function makeDraft(type: 'task' | 'note', item: TaskItem | NoteItem | null): Draft {
  const title = field(type === 'task' ? 'Title' : 'Title (optional)', () => void save());
  const outcome = type === 'task' ? textArea('Done when', 1) : null;
  const body = textArea(type === 'task' ? 'Details, in markdown' : 'Write in markdown', 8, 'field area grow body-field');
  title.value = item && 'untitled' in item && item.untitled ? '' : item?.title ?? '';
  if (outcome) outcome.value = (item as TaskItem | null)?.outcome ?? '';
  body.value = item?.body ?? '';
  return {
    type,
    id: item?.id ?? null,
    title,
    outcome,
    body,
    from: { title: title.value, outcome: outcome?.value ?? '', body: body.value },
    revision: item?.bodyRevision ?? null,
    saving: false,
    error: null,
    conflict: false,
  };
}

/**
 * Edits one item. The draft outlives leaving the screen: coming back to the
 * item finds the words still there, so nothing is lost by a stray tap.
 */
function startEditing(type: 'task' | 'note', item: TaskItem | NoteItem): void {
  draft = makeDraft(type, item);
  redraw();
  (type === 'task' ? draft.title : draft.body).focus();
}

async function save(): Promise<void> {
  if (!draft || draft.saving) return;
  const editing = draft;
  const title = editing.title.value.trim();
  const body = editing.body.value;
  if (editing.type === 'task' && !title) { editing.error = 'A task needs a title.'; redraw(); return; }
  if (editing.type === 'note' && !body.trim()) { editing.error = 'Write something in the note first.'; redraw(); return; }
  editing.saving = true;
  editing.error = null;
  redraw();

  if (!editing.id) {
    const outcome = await act<{ id: string }>('create_note', { ...(title ? { title } : {}), body });
    editing.saving = false;
    if (!outcome.ok || !outcome.result?.id) { editing.error = outcome.ok ? 'Ri didn’t say what it made.' : outcome.message; redraw(); return; }
    draft = null;
    go({ name: 'item', type: 'note', id: outcome.result.id }, 'replace');
    return;
  }

  const changes: Record<string, unknown> = {};
  if (title !== editing.from.title.trim()) changes.title = editing.type === 'note' && !title ? null : title;
  if (editing.outcome && editing.outcome.value.trim() !== editing.from.outcome.trim()) changes.outcome = editing.outcome.value.trim() || null;
  if (body !== editing.from.body) {
    changes.body = body;
    if (editing.revision !== null) changes.expected_body_revision = editing.revision;
  }
  if (!Object.keys(changes).length) { draft = null; redraw(); return; }
  const outcome = await act(editing.type === 'task' ? 'update_task' : 'update_note', { id: editing.id, ...changes });
  editing.saving = false;
  if (!outcome.ok) {
    const current = (outcome.details as { current?: { bodyRevision?: number } } | undefined)?.current;
    if (outcome.code === 'conflict' && typeof current?.bodyRevision === 'number') {
      // Their text stays in the field. Saving again is a choice made knowing.
      editing.revision = current.bodyRevision;
      editing.conflict = true;
      editing.error = null;
    } else {
      editing.error = outcome.message;
    }
    redraw();
    return;
  }
  draft = null;
  await reload();
}

function editor(editing: Draft): Node[] {
  const busy = editing.saving;
  return [
    h('div', { className: 'editor' },
      editing.title,
      editing.outcome ? h('label', { className: 'field-label' }, h('span', {}, 'Done when'), editing.outcome) : null,
      editing.body,
      editing.conflict ? h('p', { className: 'row-error', role: 'alert' }, 'This changed in Ri while you were writing. Your text is still here. Save to replace Ri’s version with yours, or Cancel to see it.') : null,
      editing.error ? h('p', { className: 'row-error', role: 'alert' }, editing.error) : null,
      h('div', { className: 'actions' },
        h('button', { type: 'button', className: 'button primary', disabled: busy, onClick: () => void save() }, busy ? 'Saving' : editing.conflict ? 'Save anyway' : 'Save'),
        h('button', { type: 'button', className: 'button', disabled: busy, onClick: () => { draft = null; if (!editing.id) back(); else { redraw(); void reload(); } } }, 'Cancel'),
      ),
    ),
  ];
}

function bodyOf(text: string, links: LinkTitles, empty: string): Node {
  if (!text.trim()) return h('p', { className: 'empty' }, empty);
  return h('div', { className: 'md' }, markdown(text, { links, openItem, openLink: open }));
}

// ─── A task ───────────────────────────────────────────────────

const ACTIONS: Command[] = ['start', 'move_to_todo', 'return_to_todo', 'move_to_consider', 'archive', 'restore'];

const subtaskField = field('Add a subtask', () => void addSubtask());
let subtaskParent: string | null = null;
let subtaskNote: string | null = null;

async function addSubtask(): Promise<void> {
  const title = subtaskField.value.trim();
  if (!title || !subtaskParent) return;
  subtaskField.disabled = true;
  const outcome = await act('create_task', { title, parentId: subtaskParent });
  subtaskField.disabled = false;
  if (outcome.ok) { subtaskField.value = ''; subtaskNote = null; } else subtaskNote = outcome.message;
  await reload();
  subtaskField.focus();
}

function task(data: Extract<ItemView, { type: 'task'; task: TaskItem }>): Node[] {
  const item = data.task;
  if (subtaskParent !== item.id) { subtaskParent = item.id; subtaskField.value = ''; subtaskNote = null; }
  if (told !== `task:${item.id}`) { told = `task:${item.id}`; tellItem('task', item.id, item.title, STATUS_LABEL[item.status].toLowerCase()); }
  const editing = draft?.type === 'task' && draft.id === item.id ? draft : null;
  const done = isFinished(item);
  const meta = taskMeta(item);
  const commands = ACTIONS.filter(command => COMMANDS[command].from.includes(item.status) && !(done && command !== 'restore'));

  const head = h('header', { className: 'item-head' },
    h('div', { className: 'item-title' },
      checkButton(item),
      editing ? null : h('h1', { className: done ? 'done' : '' }, item.title),
    ),
    meta.length || item.team ? h('div', { className: 'meta' }, ...(item.team ? dotted([...meta.filter(node => !(node instanceof HTMLElement && node.classList.contains('dot'))), h('span', { className: 'chip' }, 'Shared with a team')]) : meta)) : null,
    item.parent ? h('p', { className: 'parent' }, 'Part of ', h('button', { type: 'button', className: 'md-ref', onClick: () => openItem('task', item.parent!.id) }, item.parent.title)) : null,
    ...rowFeedback(item.id),
  );

  const toolbar = editing ? null : h('div', { className: 'toolbar' },
    ...commands.map(command => h('button', { type: 'button', className: 'button', disabled: isBusy(item), onClick: () => void change(item, command) }, COMMANDS[command].label)),
    h('button', { type: 'button', className: 'button', onClick: () => startEditing('task', item) }, icon(ICONS.pencil, 13), 'Edit'),
    state.bridge?.canDraft ? h('button', { type: 'button', className: 'button', onClick: () => void addToMessage(item.id, item.title, taskMessage(item)) }, icon(ICONS.addToMessage, 13), 'Add to message') : null,
    item.url ? h('button', { type: 'button', className: 'button quiet', onClick: () => open(item.url) }, 'Open in Ri', icon(ICONS.open, 12)) : null,
  );

  const content = editing ? editor(editing) : [
    item.outcome ? h('div', { className: 'outcome' }, h('span', { className: 'field-label' }, 'Done when'), h('p', {}, item.outcome)) : null,
    bodyOf(item.body, data.links, 'No details yet.'),
  ];

  const unfinished = data.subtasks.filter(sub => !isFinished(sub)).length;
  const subtasks = section('Subtasks', data.subtasks.length ? `${data.subtasks.length - unfinished} of ${data.subtasks.length} done` : null, null,
    data.subtasks.length ? h('ul', {}, ...data.subtasks.map(sub => row(sub))) : null,
    item.status === 'archived' ? null : h('div', { className: 'adder' }, subtaskField),
    subtaskNote ? h('p', { className: 'row-error', role: 'alert' }, subtaskNote) : null,
  );
  const notes = data.notes.length ? section('Notes', String(data.notes.length), null, h('ul', {}, ...data.notes.map(noteRow))) : null;

  return [h('article', { className: 'item' }, head, toolbar, ...content.filter((node): node is HTMLElement => Boolean(node))), subtasks, notes].filter((node): node is HTMLElement => Boolean(node));
}

// ─── A note ───────────────────────────────────────────────────

const noteErrors = new Map<string, string>();

async function setNoteStatus(note: NoteItem, status: 'active' | 'archived'): Promise<void> {
  noteErrors.delete(note.id);
  const outcome = await act('update_note', { id: note.id, status });
  if (!outcome.ok) noteErrors.set(note.id, outcome.message);
  await reload();
}

function note(data: Extract<ItemView, { type: 'note'; note: NoteItem }>): Node[] {
  const item = data.note;
  if (told !== `note:${item.id}`) { told = `note:${item.id}`; tellItem('note', item.id, item.title, item.kind === 'decision' ? 'a decision' : ''); }
  const editing = draft?.type === 'note' && draft.id === item.id ? draft : null;
  const archived = item.status === 'archived';
  const meta = dotted([
    item.kind === 'decision' ? h('span', { className: 'chip' }, 'Decision') : null,
    archived ? h('span', { className: 'chip' }, 'Archived') : null,
    item.team ? h('span', { className: 'chip' }, 'Shared with a team') : null,
    item.area ? h('span', {}, item.area) : null,
    h('span', {}, whenLabel(item.updatedAt)),
  ].filter((node): node is HTMLSpanElement => Boolean(node)));
  const error = noteErrors.get(item.id);
  const head = h('header', { className: 'item-head' },
    editing ? null : h('h1', { className: item.untitled ? 'untitled' : '' }, item.title),
    h('div', { className: 'meta' }, ...meta),
    item.task ? h('p', { className: 'parent' }, 'About ', h('button', { type: 'button', className: 'md-ref', onClick: () => openItem('task', item.task!.id) }, item.task.title)) : null,
    error ? h('p', { className: 'row-error', role: 'alert' }, error) : null,
    ...rowFeedback(item.id),
  );
  const toolbar = editing ? null : h('div', { className: 'toolbar' },
    h('button', { type: 'button', className: 'button', onClick: () => startEditing('note', item) }, icon(ICONS.pencil, 13), 'Edit'),
    state.bridge?.canDraft ? h('button', { type: 'button', className: 'button', onClick: () => void addToMessage(item.id, item.title, `Ri ${item.kind} "${item.title}". Its ID is ${item.id}: read it with get_note.`) }, icon(ICONS.addToMessage, 13), 'Add to message') : null,
    h('button', { type: 'button', className: 'button', onClick: () => void setNoteStatus(item, archived ? 'active' : 'archived') }, archived ? 'Restore' : 'Archive'),
    item.url ? h('button', { type: 'button', className: 'button quiet', onClick: () => open(item.url) }, 'Open in Ri', icon(ICONS.open, 12)) : null,
  );
  const content = editing ? editor(editing) : [bodyOf(item.body, data.links, 'This note is empty.')];
  return [h('article', { className: 'item' }, head, toolbar, ...content)].filter((node): node is HTMLElement => Boolean(node));
}

// ─── Drawing ──────────────────────────────────────────────────

export function item(data: ItemView): Node[] {
  if ('missing' in data) return [h('p', { className: 'empty' }, data.type === 'task' ? 'This task isn’t in Ri any more.' : 'This note isn’t in Ri any more.')];
  return data.type === 'task' ? task(data as Extract<ItemView, { type: 'task'; task: TaskItem }>) : note(data as Extract<ItemView, { type: 'note'; note: NoteItem }>);
}

export function newNote(): Node[] {
  if (!draft || draft.id !== null) {
    draft = makeDraft('note', null);
    const body = draft.body;
    requestAnimationFrame(() => body.focus());
  }
  return [h('article', { className: 'item' }, h('header', { className: 'item-head' }, h('h1', {}, 'New note')), ...editor(draft!))];
}
