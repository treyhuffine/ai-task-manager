/**
 * A person's agent and their own edits on shared work in My Ri
 * (docs/homes-spec.md §9.3-§9.5, P7.3 and P7.5), against a real team in its
 * own process: the agent surface takes the same path to the team as the
 * person's editor, Work with agent links an execution without moving
 * anything at the team, and a pass over the team says when it changed My Ri.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TeamConnectionRecord } from '@/db/types';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { startTeamProcess, type TeamProcess } from '@/test/fixtures/team-process';

let team: TeamProcess;
let teamRoot: string;
let home: TestHome;

beforeAll(async () => {
  teamRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-p7-agent-team-'));
  team = await startTeamProcess(teamRoot, 'Acme', 'Trey');
}, 90_000);

afterAll(async () => {
  await team?.stop();
  fs.rmSync(teamRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-p7-agent-home-' });
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

/** A task at the team assigned to this person, and its row in My Ri. */
async function assigned(me: TeamConnectionRecord, title: string, body = 'From the team.') {
  const task = await (await owner()).tasks.create.mutate({ title, rawInput: title, body, assigneeMemberId: me.memberId });
  const { syncTeam } = await import('./sync');
  await syncTeam(me.id);
  const q = await import('@/lib/db/queries');
  return { task, row: q.getTaskProjection(me.id, task.id)! };
}

async function action(name: string, input: Record<string, unknown>) {
  const { runAction } = await import('@/lib/orchestrator/dispatch');
  return runAction(name, input, { remote: false, actor: { source: 'ai' } });
}

describe('a pass over a team', () => {
  it('says how many rows it changed, and changes nothing when the team has not', async () => {
    const me = await connected('Ida');
    await (await owner()).tasks.create.mutate({ title: 'Counted', rawInput: 'Counted', assigneeMemberId: me.memberId });
    const { syncTeam, addTeamTaskToMyWork } = await import('./sync');
    expect((await syncTeam(me.id)).changed).toBe(1);
    // An added task is read every pass. Unchanged, it is not rewritten.
    const added = await (await owner()).tasks.create.mutate({ title: 'Added', rawInput: 'Added' });
    await addTeamTaskToMyWork(me.id, added.id);
    const q = await import('@/lib/db/queries');
    const before = q.getTaskProjection(me.id, added.id)!.updatedAt;
    expect((await syncTeam(me.id)).changed).toBe(0);
    expect(q.getTaskProjection(me.id, added.id)!.updatedAt).toBe(before);

    await (await owner()).tasks.update.mutate({ id: added.id, patch: { title: 'Added, renamed' } });
    expect((await syncTeam(me.id)).changed).toBe(1);
    expect(q.getTaskProjection(me.id, added.id)!.title).toBe('Added, renamed');
  }, 60_000);
});

describe('one change, both parts', () => {
  it('sends the shared part to the team and keeps the private part here', async () => {
    const me = await connected('Jo');
    const { task, row } = await assigned(me, 'Mixed');
    const { updateTaskWithShared } = await import('./commands');
    const saved = await updateTaskWithShared(row, { title: 'Mixed, renamed', userContext: 'Mine', energy: 'deep' }, { source: 'human' });
    expect(saved).toMatchObject({ title: 'Mixed, renamed', userContext: 'Mine', energy: 'deep' });
    expect(await (await owner()).tasks.get.query({ id: task.id })).toMatchObject({ title: 'Mixed, renamed', userContext: null, energy: null });
  }, 60_000);

  it('refuses a field neither side keeps before sending anything', async () => {
    const me = await connected('Kai');
    const { task, row } = await assigned(me, 'Untouched');
    const { updateTaskWithShared } = await import('./commands');
    await expect(updateTaskWithShared(row, { title: 'Should not land', recurrence: 'daily' }, { source: 'human' })).rejects.toThrow(/belongs to its team/);
    expect((await (await owner()).tasks.get.query({ id: task.id })).title).toBe('Untouched');
  }, 60_000);

  it('refuses a status change made from a stale read, sending nothing', async () => {
    const me = await connected('Lu');
    const { task, row } = await assigned(me, 'Stale status');
    const { transitionSharedTask } = await import('./commands');
    await expect(transitionSharedTask(row, 'start', { idempotencyKey: 'k', expectedStatusChangedCount: row.statusChangedCount + 1 })).rejects.toMatchObject({ code: 'conflict' });
    expect((await (await owner()).tasks.get.query({ id: task.id })).status).toBe('todo');
  }, 60_000);
});

describe("the person's agent on shared work", () => {
  it('edits, starts and completes at the team through the ordinary actions', async () => {
    const me = await connected('Mo');
    const { task, row } = await assigned(me, 'Agent work', 'Draft');
    const q = await import('@/lib/db/queries');

    const updated = await action('update_task', { id: row.id, body: 'Draft, with the agent’s findings', userContext: 'Agent notes for me' });
    expect(updated.ok).toBe(true);
    expect(await (await owner()).tasks.get.query({ id: task.id })).toMatchObject({ body: 'Draft, with the agent’s findings', userContext: null });
    expect(q.getTask(row.id)).toMatchObject({ body: 'Draft, with the agent’s findings', userContext: 'Agent notes for me' });

    expect((await action('transition_task', { id: row.id, command: 'start', idempotency_key: 'agent-start' })).ok).toBe(true);
    expect((await (await owner()).tasks.get.query({ id: task.id })).status).toBe('in_progress');
    expect((await action('complete_task', { id: row.id, idempotency_key: 'agent-done' })).ok).toBe(true);
    expect((await (await owner()).tasks.get.query({ id: task.id })).status).toBe('done');
    expect(q.getTask(row.id)?.status).toBe('done');
    const history = await (await owner()).entityVersions.list.query({ query: { entityType: 'task', entityId: task.id } });
    expect(history.versions[0]).toMatchObject({ source: 'ai', actorMemberId: me.memberId });
    // A browser sign-in cannot claim to be a home relaying an agent, and no
    // caller can ask the relay to override an actor as human.
    await expect((await owner()).tasks.update.mutate({ id: task.id, patch: { title: 'Forged source' }, actorSource: 'ai' })).rejects.toMatchObject({ data: { httpStatus: 403 } });
    const { teamFor } = await import('./connect');
    await expect((await teamFor(me.id))!.client.tasks.update.mutate({ id: task.id, patch: { title: 'Forged human' }, actorSource: 'human' as never })).rejects.toMatchObject({ data: { httpStatus: 400 } });
    const database = new Database(path.join(teamRoot, 'data.db'), { readonly: true });
    try {
      expect(database.prepare('SELECT actor_source, actor_member_id FROM task_status_changes WHERE task_id = ? ORDER BY created_at, id').all(task.id)).toEqual([
        { actor_source: 'ai', actor_member_id: me.memberId }, { actor_source: 'ai', actor_member_id: me.memberId },
      ]);
    } finally { database.close(); }
  }, 60_000);

  it("gets the team's current text back when its edit is stale, and a clear refusal for a private-only field", async () => {
    const me = await connected('Ned');
    const { task, row } = await assigned(me, 'Contested', 'One');
    await (await owner()).tasks.update.mutate({ id: task.id, patch: { body: 'Teammate wrote this' }, expectedBodyRevision: row.source!.bodyRevision });

    const stale = await action('update_task', { id: row.id, body: 'Agent wrote this' });
    expect(stale).toMatchObject({ ok: false, error: { code: 'conflict', details: { current: { body: 'Teammate wrote this' } } } });
    expect((await (await owner()).tasks.get.query({ id: task.id })).body).toBe('Teammate wrote this');

    const recurring = await action('update_task', { id: row.id, recurrence: 'daily' });
    expect(recurring).toMatchObject({ ok: false, error: { code: 'unsupported' } });

    // A personal task takes the same revision check.
    const q = await import('@/lib/db/queries');
    const mine = q.createTask({ title: 'Mine', rawInput: 'Mine', body: 'v1' });
    q.updateTask(mine.id, { body: 'v2' }, { source: 'human' });
    const stalePersonal = await action('update_task', { id: mine.id, body: 'from an old read', expected_body_revision: mine.bodyRevision });
    expect(stalePersonal).toMatchObject({ ok: false, error: { code: 'conflict', details: { current: { body: 'v2' } } } });
    expect(q.getTask(mine.id)?.body).toBe('v2');
  }, 60_000);

  it('says so when the team is out of reach, with nothing written', async () => {
    const me = await connected('Oz');
    const { row } = await assigned(me, 'Unreachable');
    const q = await import('@/lib/db/queries');
    // The team's computer is off: nothing answers where it was.
    q.saveTeamConnection({ id: me.id, name: me.name, address: 'https://127.0.0.1:1', memberId: me.memberId, memberName: me.memberName, role: me.role });
    const result = await action('update_task', { id: row.id, title: 'Lost?', userContext: 'Also not written' });
    expect(result).toMatchObject({ ok: false, error: { code: 'conflict', details: { reason: 'team_unreachable' } } });
    expect(q.getTask(row.id)).toMatchObject({ title: 'Unreachable', userContext: null });
  }, 60_000);

  it('Work with agent links a private execution and moves nothing at the team', async () => {
    const me = await connected('Pia');
    const { task, row } = await assigned(me, 'Linked privately');
    const q = await import('@/lib/db/queries');
    const ws = q.createWorkspace({ name: 'helper', cwd: home.root, isGit: false, filesToCopy: [], status: 'active' });
    const { execution } = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: null, startTask: { taskId: row.id, idempotencyKey: 'work-with-agent' } });
    expect(q.getExecutionTasks(execution.id).map((t) => t.id)).toEqual([row.id]);
    expect(q.getTask(row.id)?.status).toBe('todo');
    expect((await (await owner()).tasks.get.query({ id: task.id })).status).toBe('todo');
    // Nothing about it reaches the team.
    const teamSide = JSON.stringify(await (await owner()).tasks.get.query({ id: task.id }));
    expect(teamSide).not.toContain(execution.id);
    expect(teamSide).not.toContain('helper');
  }, 60_000);
});

describe('Publish result', () => {
  it("shares only what was chosen, with who published it, and leaves the task's status alone", async () => {
    const me = await connected('Quinn');
    const { task, row } = await assigned(me, 'Fix the login loop');
    const { saveAttachment } = await import('@/lib/attachments/save');
    const log = await saveAttachment({ data: Buffer.from('redirect loop trace'), originalName: 'trace.txt', mimeType: 'text/plain' });
    const { publishSharedTaskResult, sharedTaskPublishedResults } = await import('./commands');

    const published = await publishSharedTaskResult(row, {
      requestId: 'publish-1',
      summary: 'Fixed the redirect. The session cookie now survives the hop.',
      link: { label: 'Pull request', url: 'https://github.com/acme/app/pull/42' },
      personalAttachments: [log],
    });
    expect(published).toMatchObject({
      author: { id: me.memberId, name: 'Quinn' },
      summary: 'Fixed the redirect. The session cookie now survives the hop.',
      links: [{ label: 'Pull request', url: 'https://github.com/acme/app/pull/42' }],
      attachments: [{ originalName: 'trace.txt', size: log.size, mimeType: 'text/plain' }],
    });
    // The file is the team's own copy now, stored at the team.
    const copy = published.attachments[0];
    expect(copy.fileName).not.toBe(log.fileName);
    expect(fs.readFileSync(path.join(teamRoot, 'attachments', copy.fileName), 'utf8')).toBe('redirect loop trace');

    // The team sees it on the task, and nothing about where the work ran.
    const teamSide = await (await owner()).tasks.publishedResults.query({ taskId: task.id });
    expect(teamSide.map((r) => r.id)).toEqual([published.id]);
    expect(JSON.stringify(teamSide)).not.toContain(home.root);
    expect((await (await owner()).tasks.get.query({ id: task.id })).status).toBe('todo');
    expect((await sharedTaskPublishedResults(row)).map((r) => r.id)).toEqual([published.id]);
  }, 60_000);

  it('is the same result when retried, refuses a reused request with other content, and needs something chosen', async () => {
    const me = await connected('Rae');
    const { task, row } = await assigned(me, 'Retried');
    const { publishSharedTaskResult } = await import('./commands');
    const first = await publishSharedTaskResult(row, { requestId: 'same', summary: 'Done' });
    expect((await publishSharedTaskResult(row, { requestId: 'same', summary: 'Done' })).id).toBe(first.id);
    expect((await (await owner()).tasks.publishedResults.query({ taskId: task.id }))).toHaveLength(1);
    await expect(publishSharedTaskResult(row, { requestId: 'same', summary: 'Something else' })).rejects.toMatchObject({ code: 'conflict' });
    await expect(publishSharedTaskResult(row, { requestId: 'empty', summary: '  ' })).rejects.toThrow(/Choose a summary, a link or a file/);
    await expect(publishSharedTaskResult(row, { requestId: 'bad-link', link: { label: 'Link', url: 'javascript:alert(1)' } })).rejects.toThrow(/http or https/);
  }, 60_000);
});
