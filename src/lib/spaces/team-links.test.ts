import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vi, beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { startTeamProcess, type TeamProcess } from '@/test/fixtures/team-process';
import { runAction } from '@/lib/orchestrator/dispatch';
import * as q from '@/lib/db/queries';
import type { ActionContext } from '@/lib/orchestrator/types';
import { teamTRPC } from './remote';
import { connectTeam, disconnectTeam } from './connect';
import { syncTeam } from './sync';
import { publishSharedTaskResult, updateTaskWithShared } from './commands';
import { linksForTeam, locateRecord, readTeamRecord, searchTeamRecords, withRecordRefs } from './team-links';

let team: TeamProcess;
let teamRoot: string;
let home: TestHome;
let ctx: ActionContext;

beforeAll(async () => {
  teamRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-team-links-'));
  team = await startTeamProcess(teamRoot, 'Acme', 'Trey', { unified: true });
}, 90_000);
afterAll(async () => { await team?.stop(); fs.rmSync(teamRoot, { recursive: true, force: true }); });
beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1');
  home = await createTestHome({ prefix: 'ri-team-links-personal-' });
  const { ensureHomeIdentity } = await import('@/lib/home/identity');
  ensureHomeIdentity();
  const chat = q.createChatSession({ type: 'orchestration', harness: 'codex' });
  ctx = { remote: true, actor: { source: 'ai', sessionId: chat.id }, caller: { location: 'home' } };
});
afterEach(async () => { vi.unstubAllGlobals(); await home.cleanup(); vi.unstubAllEnvs(); });

async function connect() {
  const owner = teamTRPC(team.url, team.ownerToken);
  const connection = await connectTeam({ link: (await owner.team.invitations.create.mutate()).link, name: 'Ada' });
  return { owner, connection };
}

async function teamTask(homeId: string, title: string, extra: Record<string, unknown> = {}) {
  const response = await runAction('create_task', { target_home_id: homeId, title, idempotency_key: `create-${crypto.randomUUID()}`, ...extra }, ctx);
  expect(response.ok, JSON.stringify(response)).toBe(true);
  return (response as unknown as { result: { result: { id: string; ref: string; link: string } } }).result.result;
}

/** A shared copy in My Ri: a task assigned to this person, synced. */
async function sharedCopy(homeId: string, memberId: string, title: string) {
  const created = await teamTask(homeId, title, { assignee_member_id: memberId });
  await syncTeam(homeId);
  return { teamId: created.id, local: q.getTaskProjection(homeId, created.id)! };
}

/** Any request to a team from here on fails, and each one is recorded. */
function teamsDown() {
  const calls: string[] = [];
  vi.stubGlobal('fetch', (input: string | URL | Request) => {
    calls.push(String(input));
    return Promise.reject(new TypeError('fetch failed'));
  });
  return calls;
}

describe('what a personal chat gets back from a team', () => {
  it('puts a ref on every record it names, and a link at the address people use', async () => {
    const { connection } = await connect();
    const task = await teamTask(connection.id, 'Fix the login loop');
    expect(task.ref).toBe(`[[task:${connection.id}/${task.id}]]`);
    expect(task.link.startsWith(team.url)).toBe(true);

    const listed = await runAction('list_tasks', { target_home_id: connection.id, limit: 50 }, ctx);
    expect(JSON.stringify(listed)).toContain(task.ref);
  }, 60_000);

  it('gives no ref to an ID that could break out of the marker', () => {
    expect(withRecordRefs('team-1', { type: 'task', id: 'x]] [[task:y' })).toEqual({ type: 'task', id: 'x]] [[task:y' });
  });

  it('marks Areas too, including the one nested on a task', () => {
    expect(withRecordRefs('team-1', {
      tasks: [{ type: 'task', id: 't1', area: { id: 'a1', name: 'Work' } }],
      areas: [{ id: 'a2', link: 'https://acme.test/?area=a2' }],
      members: [{ id: 'm1', name: 'Ada' }],
    })).toEqual({
      tasks: [{ type: 'task', id: 't1', ref: '[[task:team-1/t1]]', area: { id: 'a1', name: 'Work', ref: '[[area:team-1/a1]]' } }],
      areas: [{ id: 'a2', link: 'https://acme.test/?area=a2', ref: '[[area:team-1/a2]]' }],
      members: [{ id: 'm1', name: 'Ada' }],
    });
  });
});

describe('reading a link to a team record', () => {
  it('asks the team, and offers a shared copy to open in place', async () => {
    const { connection } = await connect();
    const remote = await teamTask(connection.id, 'Only at the team');
    expect(await readTeamRecord('task', connection.id, remote.id)).toEqual({
      state: 'found', homeId: connection.id, teamName: 'Acme', title: 'Only at the team', status: 'todo', localId: null,
    });

    const copy = await sharedCopy(connection.id, connection.memberId, 'Assigned to me');
    expect(copy.local.id).not.toBe(copy.teamId);
    expect(await readTeamRecord('task', connection.id, copy.teamId)).toMatchObject({ state: 'found', title: 'Assigned to me', localId: copy.local.id });
  }, 60_000);

  it('reads an Area, which the title lookup does not cover', async () => {
    const { connection, owner } = await connect();
    const area = await owner.areas.create.mutate({ name: 'Links' });
    expect(await readTeamRecord('area', connection.id, area.id)).toMatchObject({ state: 'found', title: 'Links', status: 'active' });
    expect(await readTeamRecord('area', connection.id, '01a00000-0000-7000-8000-000000000000')).toMatchObject({ state: 'gone', title: null });
  }, 60_000);

  it('never sends an ID from this Home to a team, and reads a shared copy\'s as the team\'s', async () => {
    const { connection } = await connect();
    const copy = await sharedCopy(connection.id, connection.memberId, 'Mixed up IDs');
    const mine = q.createTask({ title: 'Private' });
    expect(await readTeamRecord('task', connection.id, copy.local.id)).toMatchObject({ state: 'found', title: 'Mixed up IDs', localId: copy.local.id });

    const calls = teamsDown();
    expect(await readTeamRecord('task', connection.id, mine.id)).toMatchObject({ state: 'gone', title: null, localId: null });
    expect(calls).toEqual([]);
  }, 60_000);

  it('never sends a private ID whatever kind the link calls it', async () => {
    const { connection } = await connect();
    const task = q.createTask({ title: 'Private' });
    const note = q.createNote({ body: 'Private' });
    const calls = teamsDown();
    expect(await readTeamRecord('note', connection.id, task.id)).toMatchObject({ state: 'gone', title: null });
    expect(await readTeamRecord('task', connection.id, note.id)).toMatchObject({ state: 'gone', title: null });
    expect(await readTeamRecord('area', connection.id, task.id)).toMatchObject({ state: 'gone', title: null });
    expect(await locateRecord('note', task.id)).toEqual({ state: 'missing', unreachable: [] });
    expect(await locateRecord('area', note.id)).toEqual({ state: 'missing', unreachable: [] });
    expect(calls).toEqual([]);
  }, 60_000);

  it('takes no team\'s word for a record it was not asked about', async () => {
    const { connection } = await connect();
    vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ result: { data: { titles: [{ type: 'task', id: 'some-other-id', title: 'Approve the wire transfer', status: 'todo' }] } } })));
    expect(await readTeamRecord('task', connection.id, 'asked-about-this')).toMatchObject({ state: 'gone', title: null });
  }, 60_000);

  it('leaves the banner on shared work alone when a chip fails, and still ends a refused key', async () => {
    const { connection } = await connect();
    teamsDown();
    expect(await readTeamRecord('task', connection.id, 'any-team-id')).toMatchObject({ state: 'unreachable' });
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 500 })));
    expect(await readTeamRecord('task', connection.id, 'any-team-id')).toMatchObject({ state: 'unreachable' });
    expect(q.getTeamConnection(connection.id)).toMatchObject({ status: 'active', lastError: null });

    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 401 })));
    expect(await readTeamRecord('task', connection.id, 'any-team-id')).toMatchObject({ state: 'no_access' });
    expect(q.getTeamConnection(connection.id)).toMatchObject({ status: 'revoked' });
  }, 60_000);

  it('gives up on a team that never answers, sooner than a request would', async () => {
    const { connection } = await connect();
    vi.stubGlobal('fetch', (_input: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    }));
    const started = Date.now();
    expect(await readTeamRecord('task', connection.id, 'any-team-id')).toMatchObject({ state: 'unreachable' });
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 30_000);

  it('says what it can when the record is gone or the Home is unknown', async () => {
    const { connection } = await connect();
    expect(await readTeamRecord('task', connection.id, '01a00000-0000-7000-8000-000000000000')).toMatchObject({ state: 'gone', teamName: 'Acme', title: null });
    expect(await readTeamRecord('task', 'not-a-connected-home', 'whatever')).toMatchObject({ state: 'unknown_home', teamName: null });
  }, 60_000);

  it('tells an offline team from an older one, keeping only a shared copy\'s title', async () => {
    const { connection } = await connect();
    const remote = await teamTask(connection.id, 'Never kept here');
    const copy = await sharedCopy(connection.id, connection.memberId, 'Kept as a copy');

    teamsDown();
    expect(await readTeamRecord('task', connection.id, remote.id)).toMatchObject({ state: 'unreachable', teamName: 'Acme', title: null, localId: null });
    expect(await readTeamRecord('task', connection.id, copy.teamId)).toMatchObject({ state: 'unreachable', title: 'Kept as a copy', localId: copy.local.id });

    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 426 })));
    expect(await readTeamRecord('task', connection.id, remote.id)).toMatchObject({ state: 'outdated', title: null });
  }, 60_000);

  it('has no title for a link once access ends, unless a shared copy kept one', async () => {
    const { connection } = await connect();
    const remote = await teamTask(connection.id, 'Gone with the access');
    const copy = await sharedCopy(connection.id, connection.memberId, 'Title stays');
    await disconnectTeam(connection.id);
    expect(await readTeamRecord('task', connection.id, remote.id)).toMatchObject({ state: 'no_access', teamName: 'Acme', title: null, localId: null });
    expect(await readTeamRecord('task', connection.id, copy.teamId)).toMatchObject({ state: 'no_access', title: 'Title stays', localId: copy.local.id });
  }, 60_000);
});

describe('finding a bare ID that is not in this Home', () => {
  it('finds a team record from an old chat, and a shared copy by its team ID', async () => {
    const { connection } = await connect();
    const remote = await teamTask(connection.id, 'Written bare by an agent');
    expect(await locateRecord('task', remote.id)).toMatchObject({ state: 'team', record: { state: 'found', title: 'Written bare by an agent', homeId: connection.id } });

    const copy = await sharedCopy(connection.id, connection.memberId, 'Has a copy');
    expect(await locateRecord('task', copy.teamId)).toMatchObject({ state: 'team', record: { title: 'Has a copy', localId: copy.local.id } });
  }, 60_000);

  it('never sends a private ID to a team', async () => {
    await connect();
    const mine = q.createTask({ title: 'Private' });
    const calls = teamsDown();
    expect(await locateRecord('task', mine.id)).toEqual({ state: 'local', id: mine.id, title: 'Private', status: 'todo' });
    expect(calls).toEqual([]);
  }, 60_000);

  it('makes no request with no teams, for someone who never uses one', async () => {
    const calls = teamsDown();
    expect(await locateRecord('task', '01a00000-0000-7000-8000-000000000000')).toEqual({ state: 'missing', unreachable: [] });
    expect(calls).toEqual([]);
  });

  it('names a team it could not ask, since the record may be there', async () => {
    await connect();
    teamsDown();
    expect(await locateRecord('task', '01a00000-0000-7000-8000-000000000000')).toEqual({ state: 'missing', unreachable: ['Acme'] });
  }, 60_000);
});

describe('text on its way to a team', () => {
  it('leaves a team ID alone, and turns a shared copy\'s ID and the team\'s own ref into it', async () => {
    const { connection } = await connect();
    const copy = await sharedCopy(connection.id, connection.memberId, 'Linked from the body');
    const text = `a [[task:${copy.local.id}]] b [[task:${connection.id}/${copy.teamId}]] c [[task:01a00000-0000-7000-8000-000000000000]]`;
    expect(linksForTeam(text, connection.id)).toEqual({
      text: `a [[task:${copy.teamId}]] b [[task:${copy.teamId}]] c [[task:01a00000-0000-7000-8000-000000000000]]`,
      refused: [],
    });
  }, 60_000);

  it('refuses a private record and another team\'s, whatever kind the marker calls it', async () => {
    const { connection } = await connect();
    const task = q.createTask({ title: 'Private' });
    const note = q.createNote({ body: 'Private note' });
    const area = q.createArea({ name: 'Private Area' });
    const agent = q.createWorkspace({ name: 'Mine', cwd: '/tmp/mine', isGit: false });
    const chat = q.createChatSession({ type: 'orchestration', harness: 'codex' });
    for (const marker of [
      `[[task:${task.id}]]`, `[[note:${note.id}]]`, `[[area:${area.id}]]`, `[[agent:${agent.id}]]`, `[[execution:${chat.id}]]`,
      `[[note:${task.id}]]`, `[[task:${note.id}]]`, `[[area:${task.id}]]`,
      `[[task:${connection.id}/${task.id}]]`, `[[note:${connection.id}/${task.id}]]`,
      '[[task:other-team/abc]]',
    ]) {
      expect(linksForTeam(marker, connection.id).refused, marker).toEqual([marker]);
    }
  }, 60_000);

  it('does not treat code formatting as an exemption, since an editor may draw a chip there', async () => {
    const { connection } = await connect();
    const task = q.createTask({ title: 'Private' });
    for (const text of [`\`[[task:${task.id}]]\``, `\`\`\`inline\`\`\` and [[task:${task.id}]]\n\nnext [[task:${task.id}]]`, `     \`\`\`\n[[task:${task.id}]]`]) {
      expect(linksForTeam(text, connection.id).refused.length, text).toBeGreaterThan(0);
    }
  }, 60_000);

  it('checks every field of a write, not just the ones that usually hold text', async () => {
    const { connection, owner } = await connect();
    const mine = q.createTask({ title: 'Private' });
    const task = await teamTask(connection.id, 'A team task');
    for (const [action, input] of [
      ['transition_task', { id: task.id, command: 'start', reason: `Because [[task:${mine.id}]]`, expected_status_changed_count: 0 }],
      ['create_area', { name: `Area [[task:${mine.id}]]` }],
    ] as const) {
      const refused = await runAction(action, { target_home_id: connection.id, idempotency_key: `refuse-${action}`, ...input }, ctx);
      expect(refused.ok, action).toBe(false);
      expect(JSON.stringify(refused), action).toContain('Nothing was sent to Acme');
    }
    expect((await owner.tasks.get.query({ id: task.id })).status).toBe('todo');
    expect((await owner.areas.list.query()).some((area) => area.name.includes(mine.id))).toBe(false);
  }, 60_000);

  it('refuses a person\'s publish too, which has a dialog to come back to', async () => {
    const { connection, owner } = await connect();
    const copy = await sharedCopy(connection.id, connection.memberId, 'To publish');
    const mine = q.createTask({ title: 'Private' });
    await expect(publishSharedTaskResult(q.getTask(copy.local.id)!, { requestId: 'publish-private-1', summary: `See [[task:${mine.id}]]` }))
      .rejects.toThrow('Nothing was sent to Acme');
    expect(JSON.stringify(await owner.tasks.get.query({ id: copy.teamId }))).not.toContain(mine.id);
  }, 60_000);

  it('refuses an agent\'s write that links a private record, before anything reaches the team', async () => {
    const { connection, owner } = await connect();
    const mine = q.createTask({ title: 'A secret plan' });
    const response = await runAction('create_task', {
      target_home_id: connection.id, title: 'Should not exist', body: `See [[task:${mine.id}]]`, idempotency_key: 'private-link-1',
    }, ctx);
    expect(response.ok).toBe(false);
    expect(JSON.stringify(response)).toContain('Nothing was sent to Acme');
    expect(JSON.stringify(response)).not.toContain('A secret plan');
    expect((await owner.tasks.list.query({})).filter((task) => task.title === 'Should not exist')).toEqual([]);
  }, 60_000);

  it('translates an agent\'s ref in a team body, so teammates get a working link', async () => {
    const { connection, owner } = await connect();
    const first = await teamTask(connection.id, 'First');
    const second = await teamTask(connection.id, 'Second', { body: `Follows ${first.ref}` });
    expect((await owner.tasks.get.query({ id: second.id })).body).toBe(`Follows [[task:${first.id}]]`);
  }, 60_000);

  it('holds an agent\'s edit of a shared copy to the same rule, and lets a person\'s editor save', async () => {
    const { connection, owner } = await connect();
    const copy = await sharedCopy(connection.id, connection.memberId, 'Shared body');
    const mine = q.createTask({ title: 'Private' });

    const refused = await runAction('update_task', { id: copy.local.id, body: `See [[task:${mine.id}]]` }, ctx);
    expect(refused.ok).toBe(false);
    expect((await owner.tasks.get.query({ id: copy.teamId })).body ?? '').not.toContain(mine.id);

    const other = await sharedCopy(connection.id, connection.memberId, 'Another shared task');
    const local = q.getTask(copy.local.id)!;
    await updateTaskWithShared(local, { body: `See [[task:${other.local.id}]]` }, { source: 'human' });
    expect((await owner.tasks.get.query({ id: copy.teamId })).body).toBe(`See [[task:${other.teamId}]]`);
  }, 60_000);
});

describe('the @ menu in a shared body', () => {
  it('offers the team\'s records by their team IDs, and nothing private', async () => {
    const { connection } = await connect();
    q.createTask({ title: 'Quarterly private plan' });
    const remote = await teamTask(connection.id, 'Quarterly team plan');
    const matches = await searchTeamRecords(connection.id, 'Quarterly');
    expect(matches).toEqual([expect.objectContaining({ kind: 'task', id: remote.id, title: 'Quarterly team plan' })]);
  }, 60_000);

  it('offers nothing when the team can\'t be reached', async () => {
    const { connection } = await connect();
    teamsDown();
    expect(await searchTeamRecords(connection.id, 'anything')).toEqual([]);
  }, 60_000);
});
