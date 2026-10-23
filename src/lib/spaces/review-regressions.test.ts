import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { startTeamProcess, type TeamProcess } from '@/test/fixtures/team-process';

let team: TeamProcess;
let root: string;
let home: TestHome;
beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-p7-review-team-'));
  team = await startTeamProcess(root);
}, 90_000);
afterAll(async () => { await team?.stop(); fs.rmSync(root, { recursive: true, force: true }); });
beforeEach(async () => { home = await createTestHome(); });
afterEach(async () => { vi.restoreAllMocks(); await home.cleanup(); });

async function connected() {
  const { teamTRPC } = await import('./remote');
  const owner = teamTRPC(team.url, team.ownerToken);
  const { connectTeam } = await import('./connect');
  const me = await connectTeam({ link: (await owner.team.invitations.create.mutate()).link, name: 'Reviewer' });
  return { owner, me };
}

it('replays a status request after My Ri already saved its successful result', async () => {
  const { owner, me } = await connected();
  const remote = await owner.tasks.create.mutate({ title: 'Retry', rawInput: 'Retry', assigneeMemberId: me.memberId });
  const { syncTeam } = await import('./sync');
  await syncTeam(me.id);
  const q = await import('@/lib/db/queries');
  const row = q.getTaskProjection(me.id, remote.id)!;
  const { transitionSharedTask, completeSharedTask } = await import('./commands');
  const opts = { idempotencyKey: 'start-retry', expectedStatusChangedCount: row.statusChangedCount };
  await transitionSharedTask(row, 'start', opts);
  expect(await transitionSharedTask(q.getTask(row.id)!, 'start', opts)).toMatchObject({ replayed: true, fromStatus: 'todo', toStatus: 'in_progress' });
  const doneOpts = { idempotencyKey: 'done-retry', expectedStatusChangedCount: q.getTask(row.id)!.statusChangedCount };
  await completeSharedTask(q.getTask(row.id)!, doneOpts);
  expect(await completeSharedTask(q.getTask(row.id)!, doneOpts)).toMatchObject({ replayed: true, fromStatus: 'in_progress', toStatus: 'done' });
}, 60_000);

it('restores explicitly saved tasks and notes after reconnecting the same member', async () => {
  const { owner, me } = await connected();
  const { teamFor, disconnectTeam, connectTeam } = await import('./connect');
  const link = (await (await teamFor(me.id))!.client.team.signIns.create.mutate()).link;
  const remote = await owner.tasks.create.mutate({ title: 'Saved', rawInput: 'Saved', body: 'Task text' });
  const note = await owner.notes.create.mutate({ title: 'Saved note', body: 'Note text' });
  const { addTeamTaskToMyWork, saveTeamNoteToMyNotes, syncTeam } = await import('./sync');
  const row = await addTeamTaskToMyWork(me.id, remote.id);
  const saved = await saveTeamNoteToMyNotes(me.id, note.id);
  const removedRemote = await owner.notes.create.mutate({ title: 'Removed note', body: 'Unwanted' });
  const removed = await saveTeamNoteToMyNotes(me.id, removedRemote.id);
  const { removeTeamNoteFromMyNotes } = await import('./sync');
  removeTeamNoteFromMyNotes(me.id, removedRemote.id);
  await disconnectTeam(me.id);
  await connectTeam({ link });
  await syncTeam(me.id);
  const q = await import('@/lib/db/queries');
  expect(q.getTask(row.id)).toMatchObject({ sourceState: 'active', body: 'Task text' });
  expect(q.getNote(saved.id)).toMatchObject({ sourceState: 'active', body: 'Note text' });
  expect(q.getNote(removed.id)).toMatchObject({ sourceState: 'released', body: '' });
}, 60_000);

it('does not resurrect team text when an in-flight sync finishes after disconnect', async () => {
  const { owner, me } = await connected();
  const remote = await owner.tasks.create.mutate({ title: 'Delayed', rawInput: 'Delayed', body: 'Shared secret', assigneeMemberId: me.memberId });
  const { syncTeam } = await import('./sync');
  await syncTeam(me.id);
  await owner.tasks.update.mutate({ id: remote.id, patch: { body: 'Changed secret' }, expectedBodyRevision: remote.bodyRevision });
  const fetcher = globalThis.fetch;
  const arrived = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const res = await fetcher(url, init);
    if (String(url).includes('/team.referenceChanges')) { arrived.resolve(); await release.promise; }
    return res;
  });
  const pass = syncTeam(me.id);
  await arrived.promise;
  const { disconnectTeam } = await import('./connect');
  await disconnectTeam(me.id);
  release.resolve();
  await pass;
  const q = await import('@/lib/db/queries');
  expect(q.getTaskProjection(me.id, remote.id)).toMatchObject({ sourceState: 'unavailable', body: null });
}, 60_000);

it('moves the viewer generation when a revoked membership clears cached content', async () => {
  const { owner, me } = await connected();
  await owner.tasks.create.mutate({ title: 'Removed', rawInput: 'Removed', assigneeMemberId: me.memberId });
  const { requestTeamSync, teamSyncGeneration } = await import('./sync');
  await requestTeamSync({ minIntervalMs: 0 });
  const before = teamSyncGeneration();
  await owner.team.removeMember.mutate({ id: me.memberId });
  await requestTeamSync({ minIntervalMs: 0 });
  expect(teamSyncGeneration()).toBeGreaterThan(before);
}, 60_000);

it('publishes and retries a summary referencing its selected personal attachment', async () => {
  const { owner, me } = await connected();
  const remote = await owner.tasks.create.mutate({ title: 'Files', rawInput: 'Files' });
  const { addTeamTaskToMyWork } = await import('./sync');
  const row = await addTeamTaskToMyWork(me.id, remote.id);
  const { saveAttachment } = await import('@/lib/attachments/save');
  const file = await saveAttachment({ data: Buffer.from('trace'), originalName: 'trace.txt', mimeType: 'text/plain' });
  const { publishSharedTaskResult } = await import('./commands');
  const input = { requestId: 'inline-file', summary: `Trace: [[file:${file.fileName}]]`, personalAttachments: [file] };
  const first = await publishSharedTaskResult(row, input);
  expect(first.summary).toContain(`[[file:${first.attachments[0].fileName}]]`);
  expect(first.summary).not.toContain(file.fileName);
  expect((await publishSharedTaskResult(row, input)).id).toBe(first.id);
}, 60_000);

it('refuses a publish request reused with different file bytes of the same size', async () => {
  const { owner, me } = await connected();
  const remote = await owner.tasks.create.mutate({ title: 'Bytes', rawInput: 'Bytes' });
  const { addTeamTaskToMyWork } = await import('./sync');
  const row = await addTeamTaskToMyWork(me.id, remote.id);
  const { saveAttachment } = await import('@/lib/attachments/save');
  const a = await saveAttachment({ data: Buffer.from('first'), originalName: 'trace.txt', mimeType: 'text/plain' });
  const b = await saveAttachment({ data: Buffer.from('other'), originalName: 'trace.txt', mimeType: 'text/plain' });
  const { publishSharedTaskResult } = await import('./commands');
  await publishSharedTaskResult(row, { requestId: 'same-bytes', personalAttachments: [a] });
  await expect(publishSharedTaskResult(row, { requestId: 'same-bytes', personalAttachments: [b] })).rejects.toMatchObject({ code: 'conflict' });
}, 60_000);

it("stops asking for saved work the team deleted, also when a reconnect found it gone", async () => {
  const { owner, me } = await connected();
  const { teamFor, disconnectTeam, connectTeam } = await import('./connect');
  const link = (await (await teamFor(me.id))!.client.team.signIns.create.mutate()).link;
  const { addTeamTaskToMyWork, saveTeamNoteToMyNotes, syncTeam } = await import('./sync');
  const task = await owner.tasks.create.mutate({ title: 'Added then deleted', rawInput: 'Added then deleted' });
  const note = await owner.notes.create.mutate({ title: 'Saved then deleted', body: 'Gone soon' });
  const laterTask = await owner.tasks.create.mutate({ title: 'Deleted while disconnected', rawInput: 'Deleted while disconnected' });
  const laterNote = await owner.notes.create.mutate({ title: 'Also deleted while disconnected', body: 'Gone later' });
  await addTeamTaskToMyWork(me.id, task.id);
  await saveTeamNoteToMyNotes(me.id, note.id);
  await addTeamTaskToMyWork(me.id, laterTask.id);
  await saveTeamNoteToMyNotes(me.id, laterNote.id);

  // Deleted while connected: the next pass says so.
  await owner.tasks.delete.mutate({ id: task.id });
  await owner.notes.delete.mutate({ id: note.id });
  await syncTeam(me.id);
  // Deleted while disconnected: the pass after reconnecting says so.
  await disconnectTeam(me.id);
  await owner.tasks.delete.mutate({ id: laterTask.id });
  await owner.notes.delete.mutate({ id: laterNote.id });
  await connectTeam({ link });
  await syncTeam(me.id);

  const q = await import('@/lib/db/queries');
  for (const id of [task.id, laterTask.id]) expect(q.getTaskProjection(me.id, id)).toMatchObject({ sourceState: 'unavailable', source: { goneAt: expect.any(String) } });
  for (const id of [note.id, laterNote.id]) expect(q.getNoteProjection(me.id, id)).toMatchObject({ sourceState: 'unavailable', source: { goneAt: expect.any(String) } });

  // Later passes ask the team for none of them.
  const fetcher = globalThis.fetch;
  const asked: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    asked.push(decodeURIComponent(String(url)));
    return fetcher(url, init);
  });
  expect(await syncTeam(me.id)).toMatchObject({ ok: true });
  for (const id of [task.id, note.id, laterTask.id, laterNote.id]) expect(asked.some((u) => u.includes(id))).toBe(false);
}, 60_000);

it('keeps a disconnect in effect when an earlier reconnect finishes late', async () => {
  const { me } = await connected();
  const { teamFor, connectTeam, disconnectTeam } = await import('./connect');
  const link = (await (await teamFor(me.id))!.client.team.signIns.create.mutate()).link;
  const arrived = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const fetcher = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const response = await fetcher(url, init);
    if (String(url).endsWith('/api/home')) { arrived.resolve(); await release.promise; }
    return response;
  });
  const reconnect = connectTeam({ link }).catch((error: unknown) => error);
  await arrived.promise;
  await disconnectTeam(me.id);
  release.resolve();
  expect(await reconnect).toMatchObject({ code: 'conflict' });
  const q = await import('@/lib/db/queries');
  const { readTeamKey } = await import('./credentials');
  expect(q.getTeamConnection(me.id)?.status).toBe('disconnected');
  expect(await readTeamKey(me.id)).toBeNull();
}, 60_000);

it('clears shared text from local version history while keeping private planning history', async () => {
  const { owner, me } = await connected();
  const remote = await owner.tasks.create.mutate({ title: 'Retained title', rawInput: 'Retained title', body: 'Team-only task text', description: 'Team-only description', outcome: 'Team-only outcome' });
  const note = await owner.notes.create.mutate({ title: 'Retained note title', body: 'Team-only note text', url: 'https://team-only.example/' });
  const { addTeamTaskToMyWork, saveTeamNoteToMyNotes } = await import('./sync');
  const taskRef = await addTeamTaskToMyWork(me.id, remote.id);
  const noteRef = await saveTeamNoteToMyNotes(me.id, note.id);
  const q = await import('@/lib/db/queries');
  const area = q.createArea({ name: 'Private area' });
  q.updateTask(taskRef.id, { userContext: 'Private retained planning' }, { source: 'human' });
  q.updateNote(noteRef.id, { areaId: area.id }, { source: 'human' });
  expect(JSON.stringify([...q.listEntityVersions('task', taskRef.id), ...q.listEntityVersions('note', noteRef.id)])).not.toMatch(/Team-only|team-only\.example/);
  // Simulate history left by an earlier build, which disconnect must scrub too.
  const { getDb } = await import('@/lib/db');
  const { entityVersions } = await import('@/lib/db/schema');
  const { eq } = await import('drizzle-orm');
  for (const [kind, id] of [['task', taskRef.id], ['note', noteRef.id]] as const) {
    for (const version of q.listEntityVersions(kind, id)) {
      getDb().update(entityVersions).set({ snapshot: { ...version.snapshot, body: 'Team-only legacy text', ...(kind === 'task' ? { description: 'Team-only legacy description', outcome: 'Team-only legacy outcome' } : { url: 'https://team-only.example/' }) } }).where(eq(entityVersions.id, version.id)).run();
    }
  }
  const { disconnectTeam } = await import('./connect');
  await disconnectTeam(me.id);
  const taskVersions = q.listEntityVersions('task', taskRef.id);
  const noteVersions = q.listEntityVersions('note', noteRef.id);
  expect(taskVersions.length).toBeGreaterThan(0);
  expect(noteVersions.length).toBeGreaterThan(0);
  expect(JSON.stringify(taskVersions)).toContain('Private retained planning');
  expect(JSON.stringify(noteVersions)).toContain(area.id);
  expect(JSON.stringify([...taskVersions, ...noteVersions])).not.toMatch(/Team-only|team-only\.example/);
}, 60_000);

it('discovers assigned work beyond the first page', async () => {
  const { owner, me } = await connected();
  // The oldest assignment is pushed out of the old fixed 500-row window.
  const first = await owner.tasks.create.mutate({ title: 'Old unfinished obligation', rawInput: 'Old unfinished obligation', assigneeMemberId: me.memberId });
  for (let i = 0; i < 500; i++) {
    await owner.tasks.create.mutate({ title: `Other assignment ${i}`, rawInput: 'Other assignment', assigneeMemberId: me.memberId });
  }
  const { syncTeam } = await import('./sync');
  expect(await syncTeam(me.id)).toMatchObject({ ok: true });
  const q = await import('@/lib/db/queries');
  expect(q.getTaskProjection(me.id, first.id)).toMatchObject({ sourceState: 'active', source: { assigned: true } });
  expect(q.listTaskProjections(me.id)).toHaveLength(501);
}, 90_000);

it('refuses an old member shared-field draft before a write after another member reconnects', async () => {
  const { owner, me } = await connected();
  const remote = await owner.tasks.create.mutate({ title: 'Original title', rawInput: 'Original title' });
  const { addTeamTaskToMyWork } = await import('./sync'); const row = await addTeamTaskToMyWork(me.id, remote.id);
  const other = await owner.team.invitations.create.mutate();
  const { teamRequest } = await import('./remote');
  const { parseTeamLink } = await import('@/lib/team/links');
  // A second browser profile/member changes this local connection identity in
  // the fixture. The retained writer still carries the original author.
  const link = parseTeamLink(other.link)!;
  const response = await teamRequest(team.url + '/api/team/public/join', { method: 'POST', body: JSON.stringify({ secret: link.secret, name: 'New member', device: { kind: 'computer', name: 'Other browser' } }) });
  expect(response.ok).toBe(true);
  const newMember = await response.json() as { member: { id: string; name: string; role: 'member' }; token: string };
  const q = await import('@/lib/db/queries');
  q.saveTeamConnection({ id: me.id, name: me.name, url: me.url, memberId: newMember.member.id, memberName: newMember.member.name, role: newMember.member.role });
  const { saveTeamKey } = await import('./credentials'); await saveTeamKey(me.id, newMember.member.id, newMember.token);
  const { updateSharedTask } = await import('./commands');
  await expect(updateSharedTask(row, { title: 'Old retained draft' }, { expectedSourceMemberId: me.memberId })).rejects.toThrow(/sign-in changed/);
  expect((await owner.tasks.get.query({ id: remote.id })).title).toBe('Original title');
});


it('keeps the last known source Area name through direct edits until sync resolves a rename', async () => {
  const { owner, me } = await connected();
  const area = await owner.areas.create.mutate({name:'Source research'});
  const task = await owner.tasks.create.mutate({title:'Edit in place',rawInput:'Edit in place',areaId:area.id,assigneeMemberId:me.memberId});
  const { syncTeam } = await import('./sync'); await syncTeam(me.id);
  const q = await import('@/lib/db/queries'); const row = q.getTaskProjection(me.id,task.id)!;
  const { updateSharedTask } = await import('./commands');
  expect((await updateSharedTask(row,{title:'Edited title'})).source?.area).toEqual({id:area.id,name:'Source research'});
  await owner.areas.update.mutate({id:area.id,patch:{name:'Renamed source'}});
  await syncTeam(me.id);
  expect(q.getTask(row.id)?.source?.area).toEqual({id:area.id,name:'Renamed source'});
});

it('refreshes a released reference for launch and releases it again on cancellation without losing private organization', async () => {
  const { owner, me } = await connected();
  const { addTeamTaskToMyWork, removeTeamTaskFromMyWork } = await import('./sync');
  const q = await import('@/lib/db/queries');
  const { appRouter } = await import('@/lib/trpc/router');
  const remote = await owner.tasks.create.mutate({ title: 'Old shared title', rawInput: 'Old shared title', body: 'Old body' });
  const reference = await addTeamTaskToMyWork(me.id, remote.id);
  q.updateTask(reference.id, { userContext: 'Private retained plan', sortKey: 'a0' }, { source: 'human' });
  removeTeamTaskFromMyWork(me.id, remote.id);
  await owner.tasks.update.mutate({ id: remote.id, patch: { title: 'Current shared title', body: 'Current body' }, expectedBodyRevision: remote.bodyRevision });
  const caller = appRouter.createCaller({ request: new Request('http://personal.test'), key: { scope: 'viewer', location: 'home', apiKeyId: 'fixture', workerDeviceId: null, sessionChatId: null } });
  const prepared = await caller.spaces.prepareAgentTask({ teamId: me.id, taskId: remote.id });
  expect(prepared).toMatchObject({ prepared: true, restoreReleased: true, task: { id: reference.id, title: 'Current shared title', body: 'Current body', userContext: 'Private retained plan', sortKey: 'a0', sourceState: 'active' } });
  const { task, prepared: _prepared, ...options } = prepared;
  expect(await caller.spaces.discardPreparedAgentTask({ id: task.id, createdAt: task.createdAt, ...options })).toEqual({ discarded: true });
  expect(q.getTask(reference.id)).toMatchObject({ sourceState: 'released', userContext: 'Private retained plan', sortKey: 'a0', source: { addedAt: null } });
}, 60_000);

it('never sends private planning, ranks, Area defaults or personal notes during synchronization', async () => {
  const { owner, me } = await connected();
  const q = await import('@/lib/db/queries');
  const { syncTeam } = await import('./sync');
  const area = q.createArea({ name: 'PRIVATE-AREA-CANARY' });
  q.setPersonalAreaDefault({ teamId: me.id, sourceAreaId: null, areaId: area.id });
  const personalChat = q.createChatSession({ type: 'orchestration', harness: 'claude' });
  q.insertChatEvent({ sessionId: personalChat.id, role: 'user', source: 'user', content: 'PRIVATE-CHAT-CANARY' });
  const remote = await owner.tasks.create.mutate({ title: 'Shared task', rawInput: 'Shared task', assigneeMemberId: me.memberId });
  await syncTeam(me.id);
  const reference = q.getTaskProjection(me.id, remote.id)!;
  q.updateTask(reference.id, { userContext: 'PRIVATE-PLAN-CANARY', sortKey: 'private-rank' }, { source: 'human' });
  q.createNote({ body: 'PRIVATE-NOTE-CANARY' });
  const requests: string[] = [], fetcher = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => { if (String(url).startsWith(team.url)) requests.push(String(url) + String(init?.body ?? '')); return fetcher(url, init); });
  expect(await syncTeam(me.id)).toMatchObject({ ok: true });
  expect(requests.join('\n')).not.toMatch(/PRIVATE-|private-rank/);
  expect(JSON.stringify(await owner.tasks.get.query({ id: remote.id }))).not.toMatch(/PRIVATE-|private-rank/);
});
