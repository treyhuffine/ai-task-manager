import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

/**
 * `listSessionReferences`, the execution's Notes & tasks view. One list in
 * three sections (in this chat, in this agent, everything else), paged by a
 * keyset cursor and searched over every title in the home. The view used to
 * load one capped payload and filter it in the browser, so anything past the
 * first hundred rows could neither be scrolled to nor found.
 */

let home: TestHome;
const savedMirror = process.env.RI_MIRROR_DISABLED;

beforeEach(async () => {
  process.env.RI_MIRROR_DISABLED = '1';
  home = await createTestHome({ prefix: 'ri-session-refs-' });
});

afterEach(async () => {
  await home.cleanup();
  if (savedMirror === undefined) delete process.env.RI_MIRROR_DISABLED;
  else process.env.RI_MIRROR_DISABLED = savedMirror;
});

async function seed() {
  const q = await import('@/lib/db/queries');
  const { getRawDb } = await import('@/lib/db');
  const workspace = q.createWorkspace({
    name: 'ri',
    cwd: '/tmp/ri-session-refs',
    isGit: false,
    filesToCopy: [],
    status: 'active',
  });
  const other = q.createWorkspace({
    name: 'other',
    cwd: '/tmp/ri-session-refs-other',
    isGit: false,
    filesToCopy: [],
    status: 'active',
  });
  const session = q.createChatSession({
    harness: 'claude',
    type: 'execution',
    status: 'active',
    workspaceId: workspace.id,
    label: 'Refs',
  });

  /** Fixed timestamps, so order never rides on how fast the test runs. */
  const at = (minute: number) => `2026-10-07T10:${String(minute).padStart(2, '0')}:00.000Z`;
  const touch = (table: 'tasks' | 'notes', id: string, minute: number) =>
    getRawDb().prepare(`UPDATE ${table} SET updated_at = ? WHERE id = ?`).run(at(minute), id);
  const task = (
    title: string,
    opts: { status?: 'consider' | 'todo' | 'in_progress' | 'done' | 'archived'; workspaceId?: string | null; minute: number; parentId?: string },
  ) => {
    const t = q.createTask({
      title,
      status: opts.status ?? 'todo',
      workspaceId: opts.workspaceId ?? null,
      parentId: opts.parentId ?? null,
    });
    touch('tasks', t.id, opts.minute);
    return t.id;
  };
  const note = (title: string | null, opts: { status?: 'active' | 'archived'; workspaceId?: string | null; minute: number }) => {
    const n = q.createNote({
      title,
      body: title ?? 'untitled body',
      status: opts.status ?? 'active',
      workspaceId: opts.workspaceId ?? null,
    });
    touch('notes', n.id, opts.minute);
    return n.id;
  };
  const mention = (entityType: 'task' | 'note', entityId: string, minute: number) =>
    q.createChatRef({
      sessionId: session.id,
      eventId: null,
      entityType,
      entityId,
      position: 0,
      createdBy: 'user',
      createdAt: at(minute),
    });

  return { q, workspace, other, session, task, note, mention, touch };
}

/** Every row the view would reach by scrolling to the end. */
function walk(
  q: Awaited<ReturnType<typeof seed>>['q'],
  base: { sessionId: string; workspaceId: string | null; q?: string },
  limit: number,
) {
  const pages = [];
  let cursor: string | null = null;
  do {
    const page = q.listSessionReferences({ ...base, cursor, limit });
    pages.push(page);
    cursor = page.nextCursor;
  } while (cursor && pages.length < 100);
  return { pages, rows: pages.flatMap((p) => p.rows) };
}

describe('listSessionReferences', () => {
  it('orders the chat, then the agent (open tasks first), then everything else', async () => {
    const { q, workspace, other, session, task, note, mention } = await seed();
    const todo = task('Agent todo', { workspaceId: workspace.id, minute: 1 });
    const inProgress = task('Agent in progress', { status: 'in_progress', workspaceId: workspace.id, minute: 2 });
    const done = task('Agent done', { status: 'done', workspaceId: workspace.id, minute: 3 });
    const agentNote = note('Agent note', { workspaceId: workspace.id, minute: 4 });
    const elsewhere = task('Other agent task', { workspaceId: other.id, minute: 5 });
    const loose = note('Loose note', { minute: 6 });
    // Never listed unless the chat mentions them.
    task('Considering', { status: 'consider', workspaceId: workspace.id, minute: 7 });
    task('Archived', { status: 'archived', minute: 8 });
    note('Archived note', { status: 'archived', minute: 9 });
    // Mentioned in the chat: listed whatever their status, last mention first.
    const archivedButMentioned = task('Archived but mentioned', { status: 'archived', workspaceId: other.id, minute: 10 });
    const mentionedNote = note('Mentioned note', { workspaceId: workspace.id, minute: 11 });
    mention('task', archivedButMentioned, 20);
    mention('note', mentionedNote, 21);
    mention('note', mentionedNote, 15); // an older mention of the same note

    const page = q.listSessionReferences({ sessionId: session.id, workspaceId: workspace.id });

    expect(page.rows.map((r) => [r.section, r.id])).toEqual([
      ['inChat', mentionedNote],
      ['inChat', archivedButMentioned],
      ['workspace', inProgress],
      ['workspace', todo],
      ['workspace', agentNote],
      ['workspace', done],
      ['all', loose],
      ['all', elsewhere],
    ]);
    expect(page.counts).toEqual({ inChat: 2, workspace: 4, all: 2 });
    expect(page.nextCursor).toBeNull();
    expect(page.rows[0]).toMatchObject({ kind: 'note', referencedAt: '2026-10-07T10:21:00.000Z' });
    expect(page.rows[1]).toMatchObject({ kind: 'task', status: 'archived' });
  });

  it('puts everything outside the chat in All when the chat has no agent', async () => {
    const { q, workspace, task, note } = await seed();
    const session = q.createChatSession({ harness: 'claude', type: 'execution', status: 'active', workspaceId: null, label: 'Loose' });
    const t = task('Agent task', { workspaceId: workspace.id, minute: 1 });
    const n = note('Loose note', { minute: 2 });

    const page = q.listSessionReferences({ sessionId: session.id, workspaceId: null });

    expect(page.rows.map((r) => [r.section, r.id])).toEqual([['all', n], ['all', t]]);
    expect(page.counts).toEqual({ inChat: 0, workspace: 0, all: 2 });
  });

  it('pages through every row exactly once, in order, with steady counts', async () => {
    const { q, workspace, session, task, note, mention } = await seed();
    const expected: string[] = [];
    const mentioned = task('Mentioned', { minute: 0 });
    mention('task', mentioned, 30);
    expected.push(mentioned);
    for (let i = 0; i < 7; i++) expected.push(task(`Agent open ${i}`, { workspaceId: workspace.id, minute: 59 - i }));
    for (let i = 0; i < 5; i++) expected.push(note(`Agent note ${i}`, { workspaceId: workspace.id, minute: 40 - i }));
    // 130 rows elsewhere, several sharing a timestamp so the id tiebreak is exercised.
    const all: string[] = [];
    for (let i = 0; i < 130; i++) all.push(task(`Filler ${i}`, { minute: Math.floor(i / 4) }));
    // Same minute → later id first.
    expected.push(...all.map((id, i) => ({ id, minute: Math.floor(i / 4), i }))
      .sort((a, b) => b.minute - a.minute || b.i - a.i)
      .map((r) => r.id));

    const { pages, rows } = walk(q, { sessionId: session.id, workspaceId: workspace.id }, 25);

    expect(pages).toHaveLength(Math.ceil(expected.length / 25));
    expect(rows.map((r) => r.id)).toEqual(expected);
    for (const page of pages) expect(page.counts).toEqual({ inChat: 1, workspace: 12, all: 130 });
    // The default page is the view's 50.
    expect(q.listSessionReferences({ sessionId: session.id, workspaceId: workspace.id }).rows).toHaveLength(q.REFERENCE_PAGE_SIZE);
  });

  it('skips nothing when a seen row moves down the list mid-scroll', async () => {
    const { q, workspace, session, task } = await seed();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push(task(`Open ${i}`, { workspaceId: workspace.id, minute: 50 - i }));
    const base = { sessionId: session.id, workspaceId: workspace.id };

    const first = q.listSessionReferences({ ...base, limit: 4 });
    // The top row gets done: it drops below every open task. An offset
    // would now start one row late and skip one.
    q.updateTask(first.rows[0]!.id, { status: 'done' }, { source: 'human' });

    const seen = new Set(first.rows.map((r) => r.id));
    let cursor = first.nextCursor;
    while (cursor) {
      const page = q.listSessionReferences({ ...base, limit: 4, cursor });
      for (const r of page.rows) seen.add(r.id);
      cursor = page.nextCursor;
    }
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  it('searches every title in the home, not just the first pages', async () => {
    const { q, workspace, session, task, note } = await seed();
    for (let i = 0; i < 150; i++) task(`Filler ${i}`, { minute: 30 + (i % 20) });
    // The oldest row there is, far past the old 100-row cap.
    const needle = task('Rotate the deploy keys', { minute: 0 });
    const agentNeedle = note('Deploy checklist', { workspaceId: workspace.id, minute: 1 });
    const base = { sessionId: session.id, workspaceId: workspace.id };

    const page = q.listSessionReferences({ ...base, q: 'DEPLOY' });
    expect(page.rows.map((r) => [r.section, r.id])).toEqual([['workspace', agentNeedle], ['all', needle]]);
    expect(page.counts).toEqual({ inChat: 0, workspace: 1, all: 1 });

    // Every word, in any order.
    expect(q.listSessionReferences({ ...base, q: '  keys   rotate ' }).rows.map((r) => r.id)).toEqual([needle]);
    expect(q.listSessionReferences({ ...base, q: 'rotate checklist' }).rows).toEqual([]);

    // A broad search still pages, with the whole match in the counts.
    const broad = walk(q, { ...base, q: 'filler' }, 40);
    expect(broad.rows).toHaveLength(150);
    expect(broad.pages[0]!.counts.all).toBe(150);
  });

  it('ranks a title that is the search, then one that starts with it, within each section', async () => {
    const { q, workspace, session, task, note } = await seed();
    const contains = task('Fix the deploy script', { workspaceId: workspace.id, minute: 9 });
    const prefix = task('Deploy keys rotation', { workspaceId: workspace.id, minute: 1 });
    const exact = note('deploy', { workspaceId: workspace.id, minute: 0 });
    const elsewhere = task('Deploy', { minute: 30 });
    const base = { sessionId: session.id, workspaceId: workspace.id };

    // Section still comes first: the exact match elsewhere trails the agent's.
    expect(q.listSessionReferences({ ...base, q: 'DEPLOY' }).rows.map((r) => r.id))
      .toEqual([exact, prefix, contains, elsewhere]);
    // A phrase ranks the same way. The cursor carries the match rank too.
    const pages = walk(q, { ...base, q: 'deploy keys' }, 1);
    expect(pages.rows.map((r) => r.id)).toEqual([prefix]);
    const all = walk(q, { ...base, q: 'deploy' }, 1);
    expect(all.rows.map((r) => r.id)).toEqual([exact, prefix, contains, elsewhere]);
  });

  it('keeps one kind when asked, counts included', async () => {
    const { q, workspace, session, task, note } = await seed();
    const t = task('Plan launch', { workspaceId: workspace.id, minute: 1 });
    const n = note('Launch notes', { minute: 2 });
    const base = { sessionId: session.id, workspaceId: workspace.id, q: 'launch' };

    const tasksOnly = q.listSessionReferences({ ...base, kind: 'task' });
    expect(tasksOnly.rows.map((r) => r.id)).toEqual([t]);
    expect(tasksOnly.counts).toEqual({ inChat: 0, workspace: 1, all: 0 });
    const notesOnly = q.listSessionReferences({ ...base, kind: 'note' });
    expect(notesOnly.rows.map((r) => r.id)).toEqual([n]);
    expect(notesOnly.counts).toEqual({ inChat: 0, workspace: 0, all: 1 });
  });

  it('takes % and _ literally', async () => {
    const { q, workspace, session, task } = await seed();
    const percent = task('Save 50% of build time', { minute: 1 });
    const underscore = task('Rename user_state', { minute: 2 });
    task('Save 500 tokens', { minute: 3 });
    task('Rename userXstate', { minute: 4 });
    const base = { sessionId: session.id, workspaceId: workspace.id };

    expect(q.listSessionReferences({ ...base, q: '0%' }).rows.map((r) => r.id)).toEqual([percent]);
    expect(q.listSessionReferences({ ...base, q: 'user_state' }).rows.map((r) => r.id)).toEqual([underscore]);
    expect(q.listSessionReferences({ ...base, q: '\\' }).rows).toEqual([]);
  });

  it('counts subtasks the way expanding shows them, without archived ones', async () => {
    const { q, workspace, session, task } = await seed();
    const parent = task('Parent', { workspaceId: workspace.id, minute: 1 });
    task('Child todo', { parentId: parent, minute: 2 });
    task('Child done', { parentId: parent, status: 'done', minute: 3 });
    task('Child archived', { parentId: parent, status: 'archived', minute: 4 });

    const page = q.listSessionReferences({ sessionId: session.id, workspaceId: workspace.id });
    expect(page.rows.find((r) => r.id === parent)).toMatchObject({ subtaskCount: 2 });
    expect(page.rows.find((r) => r.kind === 'task' && r.id !== parent)).toMatchObject({ subtaskCount: 0 });
  });

  it('refuses a cursor it did not issue', async () => {
    const { q, workspace, session } = await seed();
    const base = { sessionId: session.id, workspaceId: workspace.id };
    const stale = Buffer.from(JSON.stringify([2, 1, '2026-10-07T10:00:00.000Z', 'task', 'x'])).toString('base64url');
    for (const cursor of ['nope', stale, Buffer.from('[1,2]').toString('base64url'), Buffer.from('{"a":1}').toString('base64url')]) {
      expect(() => q.listSessionReferences({ ...base, cursor })).toThrow(q.ReferenceCursorError);
    }
  });
});

describe('GET /sessions/:id/references', () => {
  const context = { headers: new Headers(), url: 'http://ri.test/', nextUrl: new URL('http://ri.test/'), signal: new AbortController().signal };

  it('answers a page, 400 for a bad cursor and 404 for a missing chat', async () => {
    const { session, task, workspace } = await seed();
    const id = task('Ship it', { workspaceId: workspace.id, minute: 1 });
    const { GET } = await import('@/lib/server/operations/sessions/[id]/references');

    const ok = await GET({ params: { id: session.id }, query: { q: 'ship' } }, context);
    expect(ok).toMatchObject({ ok: true, data: { rows: [{ id, section: 'workspace' }], nextCursor: null } });

    expect(await GET({ params: { id: session.id }, query: { cursor: 'nope' } }, context)).toMatchObject({ ok: false, status: 400 });
    expect(await GET({ params: { id: 'missing' } }, context)).toMatchObject({ ok: false, status: 404 });
  });
});

describe('GET /sessions/:id/picker', () => {
  const context = { headers: new Headers(), url: 'http://ri.test/', nextUrl: new URL('http://ri.test/'), signal: new AbortController().signal };

  it('searches the whole home, a page per kind, with every match counted', async () => {
    const { session, task, note, workspace, other } = await seed();
    for (let i = 0; i < 12; i++) task(`Launch step ${i}`, { workspaceId: other.id, minute: i });
    const mine = task('Launch checklist', { workspaceId: workspace.id, minute: 0 });
    const n = note('Launch retro', { minute: 1 });
    const { GET } = await import('@/lib/server/operations/sessions/[id]/picker');

    const mixed = await GET({ params: { id: session.id }, query: { q: 'launch', limit: '6' } }, context);
    if (!mixed.ok) throw new Error('picker failed');
    // This agent's task leads, ahead of newer ones elsewhere.
    expect(mixed.data.tasks[0]).toEqual({ id: mine, title: 'Launch checklist', status: 'todo' });
    expect(mixed.data.tasks).toHaveLength(6);
    expect(mixed.data.notes).toEqual([{ id: n, title: 'Launch retro' }]);
    expect(mixed.data.totals).toEqual({ tasks: 13, notes: 1 });

    const tasksOnly = await GET({ params: { id: session.id }, query: { q: 'launch', kind: 'task' } }, context);
    if (!tasksOnly.ok) throw new Error('picker failed');
    expect(tasksOnly.data.tasks).toHaveLength(13);
    expect(tasksOnly.data.notes).toEqual([]);
    expect(tasksOnly.data.totals).toEqual({ tasks: 13, notes: 0 });

    expect(await GET({ params: { id: 'missing' } }, context)).toMatchObject({ ok: false, status: 404 });
  });
});
