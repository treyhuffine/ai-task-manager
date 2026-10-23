import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vi, beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { startTeamProcess, type TeamProcess } from '@/test/fixtures/team-process';
import { teamTRPC } from './remote';
import { connectTeam } from './connect';
import { runAction } from '@/lib/orchestrator/dispatch';
import * as q from '@/lib/db/queries';
import type { ActionContext } from '@/lib/orchestrator/types';
import { callAgentCli } from '@/test/fixtures/agent-cli';

let team: TeamProcess;
let teamRoot: string;
let home: TestHome;
let ctx: ActionContext;
beforeAll(async () => {
  teamRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-native-team-'));
  team = await startTeamProcess(teamRoot, 'Acme', 'Trey', { unified: true });
}, 90_000);
afterAll(async () => { await team?.stop(); fs.rmSync(teamRoot, { recursive: true, force: true }); });
beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1');
  home = await createTestHome({ prefix: 'ri-native-personal-' });
  const { ensureHomeIdentity } = await import('@/lib/home/identity');
  ensureHomeIdentity();
  const chat = q.createChatSession({ type: 'orchestration', harness: 'codex' });
  ctx = { remote: true, actor: { source: 'ai', sessionId: chat.id }, caller: { location: 'home' } };
});
afterEach(async () => { await home.cleanup(); vi.unstubAllEnvs(); });
async function connect() {
  const o = teamTRPC(team.url, team.ownerToken);
  const c = await connectTeam({ link: (await o.team.invitations.create.mutate()).link, name: 'Ada' });
  return { o, c };
}

it('routes an actual personal CLI numeric receipt to a connected Team exactly once', async () => {
  const { c, o } = await connect();
  delete process.env.RI_SESSION_CREDENTIAL;
  delete process.env.RI_HOME_TOOLS_URL;
  const args = ['create_task', '--title', 'Numeric connected CLI', '--target-home-id', c.id, '--idempotency-key', '123456789'];
  const first = await callAgentCli(args), second = await callAgentCli(args);
  expect(first.err).toBe(''); expect(second.err).toBe('');
  expect(JSON.parse(second.out).result.id).toBe(JSON.parse(first.out).result.id);
  expect((await o.tasks.list.query({})).filter(task => task.title === 'Numeric connected CLI')).toHaveLength(1);
  expect(q.listTasks().some(task => task.title === 'Numeric connected CLI')).toBe(false);
}, 60_000);
function result(response: Awaited<ReturnType<typeof runAction>>) {
  expect(response.ok, JSON.stringify(response)).toBe(true);
  return response.result as { target_home: { id: string }; result: Record<string, unknown> };
}

describe('a signed personal chat using connected Home operations', () => {
  it('preserves snake-case assignment and Area through the real MCP route', async () => {
    const { o, c } = await connect();
    const area = await o.areas.create.mutate({ name: 'MCP area' });
    const { POST } = await import('@/app/api/orchestrator/[transport]/route');
    const { sessionCredential } = await import('@/lib/orchestrator/session-credential');
    const response = await POST(new Request('http://127.0.0.1/api/orchestrator/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-ri-session': sessionCredential(ctx.actor!.sessionId!)! },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_task', arguments: { title: 'MCP assigned', targetHomeId: c.id, area_id: area.id, assignee_member_id: c.memberId, idempotency_key: 'mcp-assignment-0001' } } }),
    }));
    const raw = await response.text();
    const json = raw.includes('data:') ? raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('') : raw;
    const envelope = JSON.parse(JSON.parse(json).result.content[0].text);
    expect(envelope.ok, JSON.stringify(envelope)).toBe(true);
    const shared = await o.tasks.get.query({ id: envelope.result.result.id });
    expect(shared).toMatchObject({ areaId: area.id, assigneeMemberId: c.memberId });
    expect(q.listTaskProjections(c.id)).toEqual([]);
  });
  it('discovers the existing membership, browses unassigned and other-member work without importing, and creates exactly once', async () => {
    const { o, c } = await connect();
    const shared = await o.tasks.create.mutate({ title: 'Same title', rawInput: 'Same title', assigneeMemberId: team.ownerId });
    const personal = q.createTask({ title: 'Same title' }, { id: shared.id });
    expect((await runAction('list_homes', {}, ctx)).result).toMatchObject({ connected_homes: [expect.objectContaining({ id: c.id, state: 'active' })] });
    const read = result(await runAction('get_task', { id: shared.id, target_home_id: c.id }, ctx));
    expect(read).toMatchObject({ target_home: { id: c.id }, result: { id: shared.id, title: 'Same title' } });
    expect(q.listTaskProjections(c.id)).toEqual([]);
    result(await runAction('update_task', { id: shared.id, title: 'Team edit only', target_home_id: c.id, idempotency_key: 'native-same-id-0001' }, ctx));
    expect(q.getTask(personal.id)?.title).toBe('Same title');
    const input = { title: 'Created remotely', target_home_id: c.id, idempotency_key: 'native-create-0001' };
    const first = result(await runAction('create_task', input, ctx));
    expect(first.result.assignee).toBeNull();
    expect(result(await runAction('create_task', input, ctx)).result.id).toBe(first.result.id);
    expect(q.getTask(personal.id)?.title).toBe('Same title');
    expect(q.listTaskProjections(c.id)).toEqual([]);
    const unknown = await runAction('update_task', { id: personal.id, title: 'Wrong destination', target_home_id: 'Acme', idempotency_key: 'unknown-home-0001' }, ctx);
    expect(unknown).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(q.getTask(personal.id)?.title).toBe('Same title');
  });

  it('checks body revisions, assignment, lifecycle, notes and live membership on every operation', async () => {
    const { o, c } = await connect();
    const created = result(await runAction('create_task', { title: 'Work', target_home_id: c.id, idempotency_key: 'native-work-0001' }, ctx));
    const id = String(created.result.id);
    expect(result(await runAction('update_task', { id, assigneeMemberId: c.memberId, body: 'Shared text', expected_body_revision: 0, target_home_id: c.id, idempotency_key: 'native-body-0001' }, ctx)).result).toMatchObject({ id, body: 'Shared text' });
    expect(await runAction('update_task', { id, body: 'Stale text', expected_body_revision: 0, target_home_id: c.id, idempotency_key: 'native-stale-0001' }, ctx)).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(result(await runAction('complete_task', { id, target_home_id: c.id, idempotency_key: 'native-done-0001' }, ctx)).result).toMatchObject({ task: { id, status: 'done' } });
    const note = result(await runAction('create_note', { body: 'Decision', kind: 'decision', target_home_id: c.id, idempotency_key: 'native-note-0001' }, ctx));
    expect(note.result).toMatchObject({ kind: 'decision', body: 'Decision' });
    const publish = { target_home_id: c.id, task_id: id, idempotency_key: 'native-publish-0001', summary: 'Only this chosen summary' };
    expect(await runAction('publish_result', publish, ctx)).toMatchObject({ ok: true, result: { result: { author: { id: c.memberId }, summary: publish.summary } } });
    expect(await runAction('publish_result', publish, ctx)).toMatchObject({ ok: true, result: { replayed: true } });
    expect((await o.tasks.publishedResults.query({ taskId: id })).length).toBe(1);
    await o.team.removeMember.mutate({ id: c.memberId });
    expect(await runAction('get_task', { id, target_home_id: c.id }, ctx)).toMatchObject({ ok: false });
    expect(q.getTeamConnection(c.id)?.status).toBe('revoked');
  });

  it('refuses remote writes without stable receipts, unsigned chats, and external personal content keys', async () => {
    const { c } = await connect();
    expect(await runAction('create_task', { title: 'No receipt', target_home_id: c.id }, ctx)).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
    expect(await runAction('list_tasks', { target_home_id: c.id }, { remote: true })).toMatchObject({ ok: false, error: { code: 'unsupported' } });
    const key = q.createPersonalAiClient('Existing external content client');
    const external: ActionContext = { remote: true, caller: { location: 'elsewhere', scope: 'home_content', apiKeyId: key.client.keyId } };
    expect(await runAction('list_tasks', {}, external)).toMatchObject({ ok: true });
    expect(await runAction('list_tasks', { target_home_id: c.id }, external)).toMatchObject({ ok: false, error: { code: 'unsupported' } });
  });

  it('scopes search and paginated reads to the chosen Home and retains note status and Area filters', async () => {
    const { c, o } = await connect();
    const area = await o.areas.create.mutate({ name: 'Native pagination' });
    for (const title of ['Native one', 'Native two']) await o.tasks.create.mutate({ title, rawInput: title, areaId: area.id });
    const first = result(await runAction('list_tasks', { target_home_id: c.id, areaId: area.id, limit: 1, offset: 0, status: ['todo', 'in_progress'], orderBy: 'createdAt' }, ctx)).result;
    const second = result(await runAction('list_tasks', { target_home_id: c.id, areaId: area.id, limit: 1, offset: 1, orderBy: 'createdAt' }, ctx)).result;
    expect(first.next_offset).toBe(1);
    expect(second.next_offset).toBeNull();
    expect((first.tasks as { id: string }[])[0].id).not.toBe((second.tasks as { id: string }[])[0].id);
    expect(result(await runAction('search', { target_home_id: c.id, query: 'Native one', limit: 5 }, ctx)).result.results).toEqual(expect.arrayContaining([expect.objectContaining({ title: 'Native one' })]));
    const note = await o.notes.create.mutate({ title: 'Scoped note', body: 'Shared note', areaId: area.id });
    expect(result(await runAction('list_notes', { target_home_id: c.id, areaId: area.id, status: 'active', orderBy: 'updatedAt' }, ctx)).result.notes).toEqual([expect.objectContaining({ id: note.id })]);
    expect(result(await runAction('update_note', { target_home_id: c.id, id: note.id, status: 'archived', idempotency_key: 'native-note-archive' }, ctx)).result).toMatchObject({ id: note.id, status: 'archived' });
    expect(result(await runAction('list_areas', { target_home_id: c.id, status: 'all' }, ctx)).result.areas).toEqual(expect.arrayContaining([expect.objectContaining({ id: area.id })]));
    expect(result(await runAction('list_members', { target_home_id: c.id }, ctx)).result.you).toMatchObject({ id: c.memberId });
    expect(q.listTaskProjections(c.id)).toEqual([]);
    expect(q.listNoteProjections(c.id)).toEqual([]);
    await expect(o.spaces.areaDefaults.list.query({ id: c.id })).rejects.toThrow();
  });
});

it('rejects remote-only fields before local writes, including updates to a shared reference', async () => {
  const { o, c } = await connect();
  const { addTeamTaskToMyWork } = await import('./sync');
  const shared = await o.tasks.create.mutate({ title: 'Canonical title', rawInput: 'Canonical title' });
  const reference = await addTeamTaskToMyWork(c.id, shared.id);
  const before = q.listTasks().length;
  for (const input of [{ title: 'Local', assigneeMemberId: c.memberId }]) {
    expect(await runAction('create_task', input, ctx)).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
  }
  expect(q.listTasks()).toHaveLength(before);
  expect(await runAction('create_task', { title: 'Local retry-compatible', idempotency_key: 'ignored-local-key' }, ctx)).toMatchObject({ ok: true });
  expect(await runAction('update_task', { id: reference.id, title: 'Do not write this', assigneeMemberId: c.memberId }, ctx)).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
  expect((await o.tasks.get.query({ id: shared.id })).title).toBe('Canonical title');
  expect(await runAction('list_tasks', { assigneeMemberId: c.memberId }, ctx)).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
  expect(await runAction('create_task', { title: 'Ordinary local task' }, ctx)).toMatchObject({ ok: true });
});

it('advertises usable operations, supports links and the session alias, and filters inactive Areas', async () => {
  const { c, o } = await connect();
  const area = await o.areas.create.mutate({ name: 'Inactive native Area', status: 'inactive' });
  expect(result(await runAction('list_areas', { target_home_id: c.id, status: 'inactive' }, ctx)).result.areas).toEqual(expect.arrayContaining([expect.objectContaining({ id: area.id, status: 'inactive' })]));
  expect(result(await runAction('list_links', { target_home_id: c.id, type: 'task', id: team.fixture!.tasks[0].id }, ctx)).result).toBeDefined();
  const history = result(await runAction('get_session_messages', { target_home_id: c.id, sessionId: team.fixture!.chatId }, ctx));
  expect(JSON.stringify(history)).toContain('Retained shared answer');
  const discovery = (await runAction('list_homes', {}, ctx)).result as { connected_homes: { operations: string[] }[] };
  expect(discovery.connected_homes[0].operations).toEqual(expect.arrayContaining(['list_links', 'get_session_messages', 'publish_result']));
});

it('publishes only explicitly chosen files and returns permanent refusals without retry advice', async () => {
  const { c, o } = await connect();
  const { getAttachmentsDir } = await import('@/lib/config/paths');
  const { uuidv7 } = await import('uuidv7');
  const task = await o.tasks.create.mutate({ title: 'Publication target', rawInput: 'Publication target' });
  const file = { fileName: uuidv7() + '.txt', originalName: 'Chosen result.txt', mimeType: 'text/plain', size: 12, uploadedAt: new Date().toISOString() };
  fs.mkdirSync(getAttachmentsDir(), { recursive: true }); fs.writeFileSync(path.join(getAttachmentsDir(), file.fileName), 'Chosen bytes');
  const input = { target_home_id: c.id, task_id: task.id, idempotency_key: 'publication-files-test', summary: `Chosen [[file:${file.fileName}]]`, attachments: [file] };
  expect(await runAction('publish_result', input, ctx)).toMatchObject({ ok: true });
  const saved = (await o.tasks.publishedResults.query({ taskId: task.id }))[0];
  expect(saved.attachments).toHaveLength(1);
  expect(saved.attachments![0].fileName).not.toBe(file.fileName);
  expect(saved.summary).toContain(saved.attachments![0].fileName);
  expect(await runAction('publish_result', { ...input, idempotency_key: 'missing-file-test', attachments: [{ ...file, fileName: uuidv7() + '.txt' }] }, ctx)).toMatchObject({ ok: false, error: { details: { retryable: false } } });
  expect(await runAction('publish_result', { ...input, attachments: [], links: Array.from({ length: 6 }, (_, i) => ({ label: String(i), url: `https://example.com/${i}` })) }, ctx)).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
});

it('requires stable IDs when two connected Homes have the same name', async () => {
  const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-native-same-name-'));
  const second = await startTeamProcess(secondRoot, 'Acme');
  try {
    const first = await connect();
    const o = teamTRPC(second.url, second.ownerToken);
    const c = await connectTeam({ link: (await o.team.invitations.create.mutate()).link, name: 'Maya' });
    const discovery = (await runAction('list_homes', {}, ctx)).result as { connected_homes: { id: string; name: string }[] };
    expect(discovery.connected_homes.map(home => home.name)).toEqual(['Acme', 'Acme']);
    expect(new Set(discovery.connected_homes.map(home => home.id)).size).toBe(2);
    result(await runAction('create_task', { title: 'Second only', target_home_id: c.id, idempotency_key: 'same-name-second' }, ctx));
    expect(await o.tasks.list.query({})).toEqual([expect.objectContaining({ title: 'Second only' })]);
    expect((await first.o.tasks.list.query({})).some(task => task.title === 'Second only')).toBe(false);
    expect(await runAction('list_tasks', { target_home_id: 'Acme' }, ctx)).toMatchObject({ ok: false, error: { code: 'not_found' } });
  } finally { await second.stop(); fs.rmSync(secondRoot, { recursive: true, force: true }); }
}, 90_000);

it('reuses assigned launch references, releases them on reassignment, and discards only pristine cancelled additions', async () => {
  const { c, o } = await connect();
  const { syncTeam } = await import('./sync');
  const { spacesRouter } = await import('./router');
  const api = spacesRouter.createCaller({ key: { scope: 'viewer' }, request: new Request('http://personal.test') } as never);
  const assigned = await o.tasks.create.mutate({ title: 'Assigned launch', rawInput: 'Assigned launch', assigneeMemberId: c.memberId });
  await syncTeam(c.id);
  const ref = q.getTaskProjection(c.id, assigned.id)!;
  expect(await api.prepareAgentTask({ teamId: c.id, taskId: assigned.id })).toMatchObject({ prepared: false, task: { id: ref.id, source: { assigned: true, addedAt: null } } });
  await o.tasks.update.mutate({ id: assigned.id, patch: { assigneeMemberId: null } }); await syncTeam(c.id);
  expect(q.getTask(ref.id)?.sourceState).toBe('released');
  const workspace = q.createWorkspace({ name: 'Personal agent', cwd: home.root, isGit: false });
  const work = q.createExecutionWithChat({ workspaceId: workspace.id, label: 'Retained work', harness: 'codex' });
  q.attachExecutionToTask(work.execution.id, ref.id);
  expect(await api.prepareAgentTask({ teamId: c.id, taskId: assigned.id })).toMatchObject({ prepared: false, task: { id: ref.id, sourceState: 'released', source: { assigned: false, addedAt: null } } });
  expect(q.getTask(ref.id)?.source?.addedAt).toBeNull();
  const other = await o.tasks.create.mutate({ title: 'Unassigned launch', rawInput: 'Unassigned launch' });
  const fresh = await api.prepareAgentTask({ teamId: c.id, taskId: other.id });
  expect(fresh.prepared).toBe(true);
  expect(await api.discardPreparedAgentTask({ id: fresh.task.id, createdAt: fresh.task.createdAt })).toEqual({ discarded: true });
  expect(q.getTaskProjection(c.id, other.id)).toBeNull();
  const kept = await api.prepareAgentTask({ teamId: c.id, taskId: other.id });
  q.updateTask(kept.task.id, { userContext: 'My planning survives cancelling.' }, { source: 'human' });
  expect(await api.discardPreparedAgentTask({ id: kept.task.id, createdAt: kept.task.createdAt })).toEqual({ discarded: false });
  expect(q.getTask(kept.task.id)?.userContext).toBe('My planning survives cancelling.');
});

it('refuses unsupported Team destinations before any personal Area, rank or stream write', async () => {
  const { c } = await connect();
  const personal = q.createTask({ title: 'Personal record' });
  for (const [name, input] of [
    ['create_area', { name: 'Do not create' }],
    ['rank_task', { id: personal.id, rank: 1 }],
    ['create_stream_item', { raw_text: 'Do not capture' }],
  ] as const) {
    expect(await runAction(name, { ...input, target_home_id: c.id }, ctx)).toMatchObject({ ok: false, error: { code: 'unsupported' } });
  }
  expect(q.listAreas().some(area => area.name === 'Do not create')).toBe(false);
  expect(q.getTask(personal.id)?.sortKey).toBeNull();
});


it('preserves assigned_to_me and snake-only session IDs and rejects conflicting aliases remotely', async () => {
  const { c, o } = await connect();
  const own = await o.tasks.create.mutate({ title: 'Assigned native task', rawInput: 'Assigned native task', assigneeMemberId: c.memberId });
  const other = await o.tasks.create.mutate({ title: 'Another member native task', rawInput: 'Another member native task', assigneeMemberId: team.ownerId });
  const listed = result(await runAction('list_tasks', { target_home_id: c.id, assigned_to_me: true }, ctx));
  expect((listed.result.tasks as { id: string }[]).map(row => row.id)).toContain(own.id);
  expect((listed.result.tasks as { id: string }[]).map(row => row.id)).not.toContain(other.id);
  const history = result(await runAction('get_session_messages', { target_home_id: c.id, session_id: team.fixture!.chatId }, ctx));
  expect(JSON.stringify(history)).toContain('Retained shared answer');
  const refused = await runAction('update_task', { target_home_id: c.id, id: own.id, title: 'Must not change', areaId: 'one', area_id: 'two', idempotency_key: 'alias-conflict-request' }, ctx);
  expect(refused).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
  expect((await o.tasks.get.query({ id: own.id })).title).toBe('Assigned native task');
});
