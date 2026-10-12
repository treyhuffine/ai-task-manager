/**
 * Shared work in My Ri (docs/homes-spec.md §9.3-§9.4, P7.2-P7.3), against a
 * real team in its own process over real HTTP: what a person's Ri keeps of
 * their team work, and how a change from My Ri reaches the team.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TeamConnectionRecord } from '@/db/types';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { startTeamProcess, type TeamProcess } from '@/test/fixtures/team-process';

let team: TeamProcess;
let teamRoot: string;
let home: TestHome;

beforeAll(async () => {
  teamRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-p7-work-team-'));
  team = await startTeamProcess(teamRoot, 'Acme', 'Trey');
}, 90_000);

afterAll(async () => {
  await team?.stop();
  fs.rmSync(teamRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-p7-work-home-' });
});

afterEach(async () => {
  await home.cleanup();
});

async function owner() {
  const { teamTRPC } = await import('./remote');
  return teamTRPC(team.url, team.ownerToken);
}

async function connected(name: string): Promise<TeamConnectionRecord> {
  const { connectTeam } = await import('./connect');
  return connectTeam({ link: (await (await owner()).team.invitations.create.mutate()).link, name });
}

async function teamTask(title: string, extra: Record<string, unknown> = {}) {
  return (await owner()).tasks.create.mutate({ title, rawInput: title, ...extra });
}

async function sync(teamId: string) {
  const { syncTeam } = await import('./sync');
  const result = await syncTeam(teamId);
  expect(result.ok).toBe(true);
  return result;
}

describe('what My Ri keeps', () => {
  it('shows assigned work with its team and no import step, and nothing that is not theirs', async () => {
    const me = await connected('Maya');
    const area = await (await owner()).areas.create.mutate({ name: 'Engineering' });
    const mine = await teamTask('Fix the login loop', { body: 'Users bounce back to sign in.', assigneeMemberId: me.memberId, areaId: area.id });
    await teamTask('Somebody else’s');
    await sync(me.id);

    const q = await import('@/lib/db/queries');
    const rows = q.listTaskProjections(me.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'Fix the login loop',
      body: 'Users bounce back to sign in.',
      status: 'todo',
      sourceTaskId: mine.id,
      sourceState: 'active',
      areaId: null,
      source: { assigned: true, addedAt: null, area: { id: area.id, name: 'Engineering' }, assignee: { id: me.memberId, name: 'Maya' } },
    });
    // It's an ordinary task to My Ri: listed, searchable, no Area created.
    expect(q.listTasks({}).map((t) => t.id)).toContain(rows[0].id);
    expect(q.listAreas({ status: 'all' })).toEqual([]);
    // A second pass changes nothing and duplicates nothing.
    await sync(me.id);
    expect(q.listTaskProjections(me.id)).toHaveLength(1);
  }, 60_000);

  it('adds a task to their work without changing who it is assigned to', async () => {
    const me = await connected('Ann');
    const task = await teamTask('Unassigned research');
    const { addTeamTaskToMyWork, removeTeamTaskFromMyWork } = await import('./sync');
    const added = await addTeamTaskToMyWork(me.id, task.id);
    expect(added).toMatchObject({ title: 'Unassigned research', sourceState: 'active', source: { assigned: false, addedAt: expect.any(String) } });
    expect((await (await owner()).tasks.get.query({ id: task.id })).assigneeMemberId).toBeNull();
    await sync(me.id);
    const q = await import('@/lib/db/queries');
    expect(q.getTaskProjection(me.id, task.id)?.sourceState).toBe('active');

    removeTeamTaskFromMyWork(me.id, task.id);
    expect(q.getTaskProjection(me.id, task.id)).toMatchObject({ sourceState: 'released', status: 'archived' });
  }, 60_000);

  it('lets reassigned work leave and deleted work say so, keeping private planning', async () => {
    const me = await connected('Bo');
    const moved = await teamTask('Moved away', { assigneeMemberId: me.memberId });
    const kept = await teamTask('Kept on purpose', { assigneeMemberId: me.memberId });
    const gone = await teamTask('Deleted at the team', { assigneeMemberId: me.memberId });
    await sync(me.id);
    const q = await import('@/lib/db/queries');
    const movedRow = q.getTaskProjection(me.id, moved.id)!;
    q.updateTask(movedRow.id, { userContext: 'My notes on it', energy: 'deep' }, { source: 'human' });
    const { addTeamTaskToMyWork } = await import('./sync');
    await addTeamTaskToMyWork(me.id, kept.id);

    const o = await owner();
    await o.tasks.update.mutate({ id: moved.id, patch: { assigneeMemberId: team.ownerId } });
    await o.tasks.update.mutate({ id: kept.id, patch: { assigneeMemberId: team.ownerId } });
    await o.tasks.delete.mutate({ id: gone.id });
    await sync(me.id);

    expect(q.getTaskProjection(me.id, moved.id)).toMatchObject({ sourceState: 'released', status: 'archived', userContext: 'My notes on it', energy: 'deep' });
    expect(q.getTaskProjection(me.id, kept.id)).toMatchObject({ sourceState: 'active', source: { assigned: false, assignee: { name: 'Trey' } } });
    expect(q.getTaskProjection(me.id, gone.id)).toMatchObject({ sourceState: 'unavailable', status: 'archived' });
  }, 60_000);

  it("keeps the team's file paths for the team, and reaches them through this home in My Ri", async () => {
    const me = await connected('Cy');
    const task = await teamTask('Floor plan', { body: '![plan](/api/attachments/01abc.png)', assigneeMemberId: me.memberId });
    await sync(me.id);
    const q = await import('@/lib/db/queries');
    const row = q.getTaskProjection(me.id, task.id)!;
    expect(row.body).toBe(`![plan](/api/space/${me.id}/attachments/01abc.png)`);

    const { updateSharedTask } = await import('./commands');
    await updateSharedTask(row, { body: `${row.body} Updated.` }, { expectedBodyRevision: row.source!.bodyRevision });
    expect((await (await owner()).tasks.get.query({ id: task.id })).body).toBe('![plan](/api/attachments/01abc.png) Updated.');
  }, 60_000);
});

describe('changing shared work from My Ri', () => {
  it('sends shared edits to the team with its revision check, and reconciles a repeat', async () => {
    const me = await connected('Dee');
    const task = await teamTask('Write the release notes', { body: 'Draft', assigneeMemberId: me.memberId });
    await sync(me.id);
    const q = await import('@/lib/db/queries');
    const { updateSharedTask } = await import('./commands');
    const row = q.getTaskProjection(me.id, task.id)!;
    const base = row.source!.bodyRevision;

    const saved = await updateSharedTask(row, { title: 'Write the release notes for 2.0', body: 'Draft, from My Ri' }, { expectedBodyRevision: base });
    expect(saved).toMatchObject({ title: 'Write the release notes for 2.0', body: 'Draft, from My Ri', source: { bodyRevision: base + 1 } });
    expect(await (await owner()).tasks.get.query({ id: task.id })).toMatchObject({ title: 'Write the release notes for 2.0', body: 'Draft, from My Ri' });

    // The same text again from the old revision: it already landed.
    expect(await updateSharedTask(row, { body: 'Draft, from My Ri' }, { expectedBodyRevision: base })).toMatchObject({ source: { bodyRevision: base + 1 } });

    // A teammate edits meanwhile: a stale write is refused with their text.
    await (await owner()).tasks.update.mutate({ id: task.id, patch: { body: 'Teammate text' }, expectedBodyRevision: base + 1 });
    let conflict: unknown;
    try {
      await updateSharedTask(q.getTask(row.id)!, { body: 'My newer text' }, { expectedBodyRevision: base + 1 });
    } catch (err) {
      conflict = err;
    }
    expect(q.isBodyRevisionConflict(conflict)).toBe(true);
    expect((conflict as InstanceType<typeof q.BodyRevisionConflictError>).current).toMatchObject({ id: row.id, body: 'Teammate text', bodyRevision: base + 2 });
    expect((await (await owner()).tasks.get.query({ id: task.id })).body).toBe('Teammate text');
  }, 60_000);

  it('moves shared status at the team and completes nothing private', async () => {
    const me = await connected('Eve');
    const task = await teamTask('Ship it', { assigneeMemberId: me.memberId });
    await sync(me.id);
    const q = await import('@/lib/db/queries');
    const row = q.getTaskProjection(me.id, task.id)!;
    const subtask = q.createTask({ title: 'Try the smaller fix first', rawInput: 'Try the smaller fix first', parentId: row.id });

    const { transitionSharedTask, completeSharedTask } = await import('./commands');
    const started = await transitionSharedTask(row, 'start', { idempotencyKey: 'start-ship-it' });
    expect(started).toMatchObject({ fromStatus: 'todo', toStatus: 'in_progress' });
    expect((await (await owner()).tasks.get.query({ id: task.id })).status).toBe('in_progress');
    // Retried with the same key, it's the same command, not a second one.
    expect((await transitionSharedTask(row, 'start', { idempotencyKey: 'start-ship-it' })).toStatus).toBe('in_progress');

    const done = await completeSharedTask(q.getTask(row.id)!);
    expect(done.task.status).toBe('done');
    expect((await (await owner()).tasks.get.query({ id: task.id })).status).toBe('done');
    expect(q.getTask(subtask.id)?.status).toBe('todo');
  }, 60_000);

  it('never writes shared fields or status locally, and keeps private planning local', async () => {
    const me = await connected('Fay');
    const task = await teamTask('Guarded', { assigneeMemberId: me.memberId });
    await sync(me.id);
    const q = await import('@/lib/db/queries');
    const row = q.getTaskProjection(me.id, task.id)!;
    expect(() => q.updateTask(row.id, { title: 'Local title' }, { source: 'human' })).toThrow(/belongs to its team/);
    expect(() => q.updateTask(row.id, { recurrence: 'daily' }, { source: 'human' })).toThrow(/belongs to its team/);
    expect(() => q.transitionTask({ taskId: row.id, command: 'start', idempotencyKey: 'x', meta: { source: 'human' } })).toThrow(/belongs to its team/);
    expect(() => q.deleteTask(row.id)).toThrow(/belongs to its team/);
    expect(q.updateTask(row.id, { energy: 'light', effort: 'small', userContext: 'Only mine' }, { source: 'human' })).toMatchObject({ energy: 'light', userContext: 'Only mine' });
    // None of it reaches the team.
    const teamSide = await (await owner()).tasks.get.query({ id: task.id });
    expect(teamSide).toMatchObject({ energy: null, effort: null, userContext: null });
  }, 60_000);

  it('a reconnect keeps one row per team task', async () => {
    const me = await connected('Gus');
    await teamTask('Once', { assigneeMemberId: me.memberId });
    await sync(me.id);
    const { readTeamKey } = await import('./credentials');
    const { teamTRPC } = await import('./remote');
    const asGus = teamTRPC(team.url, (await readTeamKey(me.id))!.token);
    const { connectTeam } = await import('./connect');
    await connectTeam({ link: (await asGus.team.signIns.create.mutate()).link });
    await sync(me.id);
    const q = await import('@/lib/db/queries');
    expect(q.listTaskProjections(me.id)).toHaveLength(1);
  }, 60_000);
});

describe('saved team notes', () => {
  it('keeps a reference beside personal notes, follows the team, and never edits it here', async () => {
    const me = await connected('Hal');
    const o = await owner();
    const note = await o.notes.create.mutate({ title: 'Launch plan', body: 'Ship on Friday. ![chart](/api/attachments/01chart.png)' });
    const { saveTeamNoteToMyNotes, syncTeam } = await import('./sync');
    const saved = await saveTeamNoteToMyNotes(me.id, note.id);
    expect(saved).toMatchObject({
      title: 'Launch plan',
      body: `Ship on Friday. ![chart](/api/space/${me.id}/attachments/01chart.png)`,
      status: 'active',
      sourceTeamId: me.id,
      sourceNoteId: note.id,
      sourceState: 'active',
    });
    // Saving it again is saving it once.
    expect((await saveTeamNoteToMyNotes(me.id, note.id)).id).toBe(saved.id);

    const q = await import('@/lib/db/queries');
    expect(() => q.updateNote(saved.id, { body: 'Edited here' }, { source: 'human' })).toThrow(/belongs to its team/);
    expect(() => q.updateNote(saved.id, { status: 'archived' }, { source: 'human' })).toThrow(/belongs to its team/);
    expect(() => q.deleteNote(saved.id)).toThrow(/Remove it from your notes/);
    const area = q.createArea({ name: 'Work' });
    expect(q.updateNote(saved.id, { areaId: area.id }, { source: 'human' })?.areaId).toBe(area.id);

    // A change at the team arrives with the next pass.
    await o.notes.update.mutate({ id: note.id, patch: { body: 'Ship on Monday.' }, expectedBodyRevision: (await o.notes.get.query({ id: note.id })).bodyRevision });
    expect((await syncTeam(me.id)).changed).toBeGreaterThanOrEqual(1);
    expect(q.getNote(saved.id)).toMatchObject({ body: 'Ship on Monday.', areaId: area.id });
    expect((await syncTeam(me.id)).changed).toBe(0);
    // Nothing private reached the team.
    expect((await o.notes.get.query({ id: note.id })).areaId).toBeNull();
  }, 60_000);

  it('lets a removed or deleted note go, keeping its title and organization and none of its text', async () => {
    const me = await connected('Ivy');
    const o = await owner();
    const kept = await o.notes.create.mutate({ title: 'Kept then removed', body: 'Team text' });
    const gone = await o.notes.create.mutate({ title: 'Deleted at the team', body: 'Team text' });
    const { saveTeamNoteToMyNotes, removeTeamNoteFromMyNotes, syncTeam } = await import('./sync');
    await saveTeamNoteToMyNotes(me.id, kept.id);
    await saveTeamNoteToMyNotes(me.id, gone.id);

    removeTeamNoteFromMyNotes(me.id, kept.id);
    await o.notes.delete.mutate({ id: gone.id });
    await syncTeam(me.id);

    const q = await import('@/lib/db/queries');
    expect(q.getNoteProjection(me.id, kept.id)).toMatchObject({ title: 'Kept then removed', body: '', status: 'archived', sourceState: 'released' });
    expect(q.getNoteProjection(me.id, gone.id)).toMatchObject({ title: 'Deleted at the team', body: '', status: 'archived', sourceState: 'unavailable' });
    expect((await o.notes.get.query({ id: kept.id })).body).toBe('Team text');
    // Saved again, it's the same reference with the team's text back.
    expect(await saveTeamNoteToMyNotes(me.id, kept.id)).toMatchObject({ id: q.getNoteProjection(me.id, kept.id)!.id, body: 'Team text', sourceState: 'active' });
  }, 60_000);

  it("clears a team's saved notes and shared text when the connection ends, keeping private planning", async () => {
    const me = await connected('Jay');
    const o = await owner();
    const note = await o.notes.create.mutate({ title: 'Secret plan', body: 'Quarantined zebra wording' });
    const task = await teamTask('Team task', { body: 'Quarantined zebra wording', assigneeMemberId: me.memberId });
    const { saveTeamNoteToMyNotes } = await import('./sync');
    await saveTeamNoteToMyNotes(me.id, note.id);
    await sync(me.id);
    const q = await import('@/lib/db/queries');
    q.updateTask(q.getTaskProjection(me.id, task.id)!.id, { userContext: 'Mine' }, { source: 'human' });
    const { ftsSearch } = await import('@/lib/embeddings/search');
    expect(ftsSearch('zebra').length).toBe(2);

    const { disconnectTeam } = await import('./connect');
    await disconnectTeam(me.id);
    expect(q.getNoteProjection(me.id, note.id)).toMatchObject({ body: '', sourceState: 'unavailable', status: 'archived' });
    expect(q.getTaskProjection(me.id, task.id)).toMatchObject({ body: null, userContext: 'Mine', sourceState: 'unavailable', status: 'archived' });
    // Nothing of the team's text can be found here any more.
    expect(ftsSearch('zebra')).toEqual([]);
  }, 60_000);
});
