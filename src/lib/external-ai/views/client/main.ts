/**
 * Ri's tasks view: today's deck or a task list, drawn inside ChatGPT, Claude
 * or any MCP Apps host (docs/mcp-oauth.md, "Views"). It follows the deck's
 * own grammar (docs/deck-layout.md): deadlines pinned on top, a flat ranked
 * stack, status as quiet chips, the deck's reasoning as one-line glimpses.
 * A check finishes a task, Start starts it, and the title opens it in Ri.
 * Browser code: bundled into the view by `pnpm mcp-views:build`.
 */
import type { DeckView, TasksView, ViewTask } from '../data';
import { connect, type Bridge, type HostContext, type ToolResult } from './bridge';

type View = DeckView | TasksView;

const root = document.getElementById('root')!;
let bridge: Bridge | null = null;
let view: View | null = null;
let toolArgs: Record<string, unknown> = {};
/** Tasks with a change on its way, so a double tap can't send two. */
const pending = new Set<string>();
/** A row's last error, shown under it until the next change. */
const rowErrors = new Map<string, string>();
let notice: string | null = null;
/** The last redraw from Ri failed, so what's on screen may be behind. */
let stale = false;

// ─── Small DOM helpers ────────────────────────────────────────

type Child = Node | string | null | false | undefined;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (name.startsWith('on') && typeof value === 'function') element.addEventListener(name.slice(2).toLowerCase(), value as EventListener);
    else if (name === 'className') element.className = String(value);
    else element.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) if (child) element.append(child);
  return element;
}

const SVG = 'http://www.w3.org/2000/svg';
function icon(paths: string[], size = 14): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
const CHECK = ['M20 6 9 17l-5-5'];
const OPEN = ['M7 17 17 7', 'M8 7h9v9'];

// ─── Dates, in the host's language and zone ───────────────────

function locale(): string | undefined {
  return bridge?.context.locale || undefined;
}

function localDay(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function dayLabel(value: string, withWeekday = true): string {
  return localDay(value).toLocaleDateString(locale(), withWeekday ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' });
}

function deadlineLabel(task: ViewTask): { text: string; tone: 'danger' | 'warning' | 'quiet' } | null {
  if (!task.deadline || task.daysUntil === null) return null;
  if (task.daysUntil < 0) return { text: `Overdue ${-task.daysUntil} ${task.daysUntil === -1 ? 'day' : 'days'}`, tone: 'danger' };
  if (task.daysUntil === 0) return { text: 'Due today', tone: 'warning' };
  if (task.daysUntil === 1) return { text: 'Due tomorrow', tone: 'warning' };
  if (task.daysUntil < 7) return { text: `Due ${localDay(task.deadline).toLocaleDateString(locale(), { weekday: 'long' })}`, tone: 'quiet' };
  return { text: `Due ${dayLabel(task.deadline, false)}`, tone: 'quiet' };
}

// ─── Talking to Ri ────────────────────────────────────────────

interface Envelope { ok: boolean; result?: unknown; error?: { code?: string; message?: string } }

function envelopeOf(result: ToolResult): Envelope {
  const text = result.content?.find(part => part.type === 'text')?.text;
  try { return text ? JSON.parse(text) as Envelope : { ok: !result.isError }; }
  catch { return { ok: !result.isError, error: { message: text } }; }
}

function idempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Draw what Ri says now. Reuses the call that drew the view, so a filtered list stays filtered. */
async function refresh(): Promise<void> {
  if (!bridge || !view) return;
  try {
    const result = await bridge.callTool(view.view === 'deck' ? 'show_deck' : 'show_tasks', view.view === 'deck' ? {} : toolArgs);
    stale = Boolean(result.isError || !result.structuredContent);
    if (!stale) show(result.structuredContent as unknown as View);
  } catch {
    stale = true;
  }
}

async function change(task: ViewTask, command: 'complete' | 'start' | 'reopen'): Promise<void> {
  if (!bridge || pending.has(task.id)) return;
  pending.add(task.id);
  rowErrors.delete(task.id);
  const before = task.status;
  // Show it at once, then what Ri answered, then the redraw from Ri.
  task.status = command === 'complete' ? 'done' : command === 'start' ? 'in_progress' : 'todo';
  render();
  const base = { id: task.id, idempotency_key: idempotencyKey(), expected_status_changed_count: task.statusChangedCount };
  try {
    const result = command === 'complete'
      ? await bridge.callTool('complete_task', base)
      : await bridge.callTool('transition_task', { ...base, command });
    const envelope = envelopeOf(result);
    if (result.isError || !envelope.ok) {
      task.status = before;
      rowErrors.set(task.id, envelope.error?.code === 'conflict'
        ? 'This task changed in Ri, so that didn’t go through.'
        : envelope.error?.message?.slice(0, 200) || 'Ri couldn’t make that change.');
    } else {
      // Good even if the redraw below fails: a repeating task's next date, and the count the next change needs.
      const outcome = (envelope.result ?? {}) as { toStatus?: ViewTask['status']; statusChangedCount?: number; nextRecurrenceAt?: string | null };
      if (outcome.toStatus) task.status = outcome.toStatus;
      if (typeof outcome.statusChangedCount === 'number') task.statusChangedCount = outcome.statusChangedCount;
      if (outcome.nextRecurrenceAt) task.nextOccurrence = outcome.nextRecurrenceAt;
      const done = command === 'complete' ? 'marked done' : command === 'start' ? 'started' : 'reopened';
      void bridge.updateModelContext(`In the Ri view, the person ${done} the task "${task.title}" (${task.id}).`).catch(() => {});
    }
  } catch {
    task.status = before;
    rowErrors.set(task.id, 'Ri didn’t answer. Try again.');
  }
  render();
  // The row stays busy until Ri's own answer is drawn, so a quick second tap
  // never sends the count from before this change.
  await refresh();
  pending.delete(task.id);
  render();
}

function open(url: string | null): void {
  if (url && bridge) void bridge.openLink(url).catch(() => {});
}

// ─── Drawing ──────────────────────────────────────────────────

function row(task: ViewTask, options: { reason?: boolean } = {}): HTMLLIElement {
  // A repeating task finished for now looks done, and has nothing to press until its next date.
  const next = task.nextOccurrence ? new Date(task.nextOccurrence).toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric' }) : null;
  const done = task.status === 'done' || next !== null;
  const busy = pending.has(task.id);
  const deadline = deadlineLabel(task);
  const meta: Child[] = [];
  const push = (node: Child) => { if (node) meta.push(node); };
  if (task.status === 'in_progress') push(h('span', { className: 'chip' }, 'In progress'));
  if (task.status === 'consider') push(h('span', { className: 'chip' }, 'Considering'));
  if (task.blocked && !done) push(h('span', { className: 'chip' }, 'Blocked'));
  if (task.area) push(h('span', {}, task.area));
  if (deadline && !done) push(h('span', { className: `tone-${deadline.tone}` }, deadline.text));
  if (next) push(h('span', {}, `Next ${next}`));
  else if (task.recurring) push(h('span', {}, 'Repeats'));

  const titleText = h('span', { className: 'title-text' }, task.title);
  const title = task.url
    ? h('button', { type: 'button', className: 'title link', onClick: () => open(task.url) }, titleText)
    : h('span', { className: 'title' }, titleText);

  const reason = options.reason && task.reason && !done
    ? h('button', { type: 'button', className: 'reason', 'aria-expanded': 'false', onClick: (event: Event) => {
      const target = event.currentTarget as HTMLElement;
      target.setAttribute('aria-expanded', String(target.classList.toggle('open')));
    } }, task.reason)
    : null;

  const start = !done && (task.status === 'todo' || task.status === 'consider')
    ? h('button', { type: 'button', className: 'start', disabled: busy, 'aria-label': `Start ${task.title}`, onClick: () => void change(task, 'start') }, 'Start')
    : null;

  const error = rowErrors.get(task.id);
  return h('li', { className: `row${done ? ' done' : ''}${busy ? ' busy' : ''}`, 'data-task': task.id },
    h('button', {
      type: 'button', className: 'check', disabled: busy || next !== null || task.status === 'archived',
      'aria-pressed': String(done), 'aria-label': next ? `${task.title} is done until ${next}` : done ? `Reopen ${task.title}` : `Mark ${task.title} done`,
      onClick: () => void change(task, done ? 'reopen' : 'complete'),
    }, done ? icon(CHECK, 12) : null),
    h('div', { className: 'body' },
      title,
      meta.length ? h('div', { className: 'meta' }, ...meta.flatMap((node, index) => index ? [h('span', { className: 'dot', 'aria-hidden': 'true' }, '·'), node] : [node])) : null,
      reason,
      error ? h('p', { className: 'row-error', role: 'alert' }, error) : null,
    ),
    start,
  );
}

function section(label: string, meta: Child, aside: Child, ...body: Child[]): HTMLElement {
  return h('section', {},
    h('header', { className: 'section-head' }, h('h2', {}, label), meta ? h('span', { className: 'section-meta' }, meta) : null, aside ? h('span', { className: 'aside' }, aside) : null),
    ...body,
  );
}

function footer(url: string | null): HTMLElement | null {
  return url ? h('footer', {}, h('button', { type: 'button', className: 'open', onClick: () => open(url) }, 'Open Ri', icon(OPEN, 12))) : null;
}

function deck(data: DeckView): Node[] {
  const nodes: Node[] = [];
  if (data.deadlines.length) {
    nodes.push(section('Deadlines', String(data.deadlines.length), null, h('ul', {}, ...data.deadlines.map(task => row(task)))));
  }
  const label = data.isToday || !data.forDate ? 'Today' : 'Deck';
  const meta = data.forDate ? dayLabel(data.forDate) : null;
  const aside = data.inProgress ? h('span', { className: 'chip' }, `${data.inProgress} in progress`) : null;
  const stale = data.forDate && !data.isToday ? h('p', { className: 'note' }, `This is the deck for ${dayLabel(data.forDate)}. Today’s isn’t made yet.`) : null;
  const framing = data.framing ? h('button', { type: 'button', className: 'reason framing', 'aria-expanded': 'false', onClick: (event: Event) => {
    const target = event.currentTarget as HTMLElement;
    target.setAttribute('aria-expanded', String(target.classList.toggle('open')));
  } }, data.framing) : null;
  const body = data.items.length
    ? h('ol', {}, ...data.items.map(task => row(task, { reason: true })))
    : h('p', { className: 'empty' }, data.forDate ? 'Nothing is on this deck.' : 'There’s no deck yet. Ri makes one each morning, or open Ri to make one now.');
  nodes.push(section(label, meta, aside, stale, framing, body));
  const end = footer(data.url);
  if (end) nodes.push(end);
  return nodes;
}

function tasks(data: TasksView): Node[] {
  const more = data.more ? h('p', { className: 'note' }, 'More in Ri.') : null;
  const body = data.items.length ? h('ul', {}, ...data.items.map(task => row(task))) : h('p', { className: 'empty' }, 'No tasks match.');
  const nodes: Node[] = [section(data.title, data.items.length ? `${data.items.length}${data.more ? '+' : ''}` : null, null, body, more)];
  const end = footer(data.url);
  if (end) nodes.push(end);
  return nodes;
}

function render(): void {
  const nodes: Node[] = [];
  if (notice) nodes.push(h('p', { className: 'notice', role: 'status' }, notice));
  if (stale) nodes.push(h('p', { className: 'notice', role: 'status' }, 'This view may be out of date. ', h('button', { type: 'button', className: 'retry', onClick: () => void refresh().then(render) }, 'Try again')));
  if (view) nodes.push(...(view.view === 'deck' ? deck(view) : tasks(view)));
  else if (!notice) nodes.push(h('p', { className: 'loading', role: 'status' }, 'Loading from Ri'));
  root.replaceChildren(...nodes);
}

function show(next: View): void {
  if (next?.view !== 'deck' && next?.view !== 'tasks') return;
  view = next;
  notice = null;
  render();
}

// ─── The host's look ──────────────────────────────────────────

function applyContext(context: HostContext): void {
  const html = document.documentElement;
  if (context.theme) html.dataset.theme = context.theme;
  for (const [name, value] of Object.entries(context.styles?.variables ?? {})) {
    if (name.startsWith('--') && value) html.style.setProperty(name, value);
  }
  if (context.styles?.css?.fonts && !document.getElementById('host-fonts')) {
    document.head.append(h('style', { id: 'host-fonts' }, context.styles.css.fonts));
  }
  html.dataset.hover = context.deviceCapabilities?.hover === false || context.deviceCapabilities?.touch ? 'none' : 'hover';
  if (context.locale) html.lang = context.locale;
}

// ─── Start ────────────────────────────────────────────────────

render();
connect({
  toolInput: args => { toolArgs = args; },
  toolResult: result => {
    if (result.isError || !result.structuredContent) { notice = 'Ri couldn’t load this.'; render(); return; }
    show(result.structuredContent as unknown as View);
  },
  hostContext: applyContext,
  cancelled: () => { if (!view) { notice = 'Cancelled.'; render(); } },
}).then(connected => {
  bridge = connected;
  applyContext(connected.context);
  render();
  let last = 0;
  new ResizeObserver(() => {
    const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
    if (height !== last) { last = height; connected.sizeChanged(height); }
  }).observe(document.documentElement);
}).catch(() => {
  notice = 'This view needs an app that shows MCP views.';
  render();
});
