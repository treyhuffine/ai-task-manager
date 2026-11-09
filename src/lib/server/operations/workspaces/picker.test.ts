import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import { operationContext } from '@/lib/server/operation';
import { GET, GETInput } from './picker';
import { GET as chatPicker } from '@/lib/server/operations/sessions/[id]/picker';

let home: TestHome;
beforeEach(async () => { home = await createTestHome({ prefix: 'ri-launch-picker-' }); });
afterEach(async () => { await home.cleanup(); });

async function search(query: { workspaceId?: string; q?: string; kind?: 'task' | 'note'; limit?: string }) {
  const input = { query };
  const result = await GET(input, operationContext(new Request('http://fixture/api/trpc'), input, '/workspaces/picker'));
  if (!result.ok) throw new Error(JSON.stringify(result.body));
  return result.data;
}

it('searches tasks and notes before creating a chat, with selected-agent work first', async () => {
  const workspace = q.createWorkspace({ name: 'Roast', cwd: home.root, isGit: false, status: 'active', filesToCopy: [] });
  const task = q.createTask({ title: 'Roast plan', workspaceId: workspace.id });
  const note = q.createNote({ title: 'Roast checklist', body: 'Keep this context.', workspaceId: workspace.id });
  const unrelated = q.createTask({ title: 'Roast supplies' });
  const result = await search({ workspaceId: workspace.id, q: 'roast' });
  expect(result.tasks.map(t => t.id)).toEqual([task.id, unrelated.id]);
  expect(result.notes.map(n => n.id)).toEqual([note.id]);
  expect(result.totals).toEqual({ tasks: 2, notes: 1 });
  expect(q.listChatSessions()).toEqual([]);
});

it('browses without an agent, filters by kind, and preserves total counts beyond the page', async () => {
  for (let i = 0; i < 5; i++) q.createTask({ title: `Roast ${i}` });
  q.createTask({ title: 'Unrelated' });
  const note = q.createNote({ title: 'Roast note', body: 'Notes.' });
  const tasks = await search({ q: 'roast', kind: 'task', limit: '2' });
  expect(tasks.tasks).toHaveLength(2);
  expect(tasks.notes).toEqual([]);
  expect(tasks.totals).toEqual({ tasks: 5, notes: 0 });
  const notes = await search({ q: 'roast', kind: 'note' });
  expect(notes.tasks).toEqual([]);
  expect(notes.notes.map(n => n.id)).toEqual([note.id]);
});

it('keeps an existing chat\'s prior references without carrying them into New chat', async () => {
  const chat = q.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active' });
  const archived = q.createTask({ title: 'Archived context', status: 'archived' });
  q.pinSessionRef({ sessionId: chat.id, entityType: 'task', entityId: archived.id, createdBy: 'user' });
  const input = { params: { id: chat.id }, query: { kind: 'task' as const } };
  const result = await chatPicker(input, operationContext(new Request('http://fixture/api/trpc'), input, '/sessions/[id]/picker'));
  expect(result).toMatchObject({ ok: true, data: { tasks: [{ id: archived.id }], totals: { tasks: 1, notes: 0 } } });
  expect((await search({ kind: 'task' })).tasks).toEqual([]);
});

it('refuses an unknown agent and invalid search inputs', async () => {
  const input = { query: { workspaceId: 'missing' } };
  expect(await GET(input, operationContext(new Request('http://fixture/api/trpc'), input, '/workspaces/picker'))).toMatchObject({ ok: false, status: 404 });
  expect(GETInput.safeParse({ query: { kind: 'other' } }).success).toBe(false);
  expect(GETInput.safeParse({ query: { q: 'x'.repeat(201) } }).success).toBe(false);
});
