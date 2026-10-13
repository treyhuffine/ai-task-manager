/**
 * A personal home joining and connecting a real team (docs/homes-spec.md
 * §3.1, §9.3, P7.1): the team runs in a process of its own and the home
 * reaches it over real HTTP, by address, with a member's key.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { startTeamProcess, type TeamProcess } from '@/test/fixtures/team-process';

let team: TeamProcess;
let teamRoot: string;
let home: TestHome;

beforeAll(async () => {
  teamRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-p7-team-'));
  team = await startTeamProcess(teamRoot, 'Acme', 'Trey');
}, 90_000);

afterAll(async () => {
  await team?.stop();
  fs.rmSync(teamRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-p7-home-' });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await home.cleanup();
});

async function owner() {
  const { teamTRPC } = await import('./remote');
  return teamTRPC(team.url, team.ownerToken, 'Acme');
}

async function invitation(): Promise<string> {
  return (await (await owner()).team.invitations.create.mutate()).link;
}

/** Someone joining directly in a browser, the P6 way. */
async function joinInBrowser(name: string): Promise<{ token: string; id: string }> {
  const res = await fetch(`${team.url}/api/team/public/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (iPhone)' },
    body: JSON.stringify({ secret: new URL(await invitation()).hash.split('=')[1], name }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token: string; member: { id: string } };
  return { token: body.token, id: body.member.id };
}

async function status(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'ok';
  } catch (err) {
    const { teamRequestProblem } = await import('./remote');
    const { isTeamError } = await import('@/lib/db/queries');
    return teamRequestProblem(err)?.problem ?? (isTeamError(err) ? err.code : String(err));
  }
}

describe('joining from My Ri', () => {
  it('concurrent retries keep the same member and a usable sign-in', async () => {
    const { connectTeam, teamFor } = await import('./connect');
    const link = await invitation();
    const [first, retry] = await Promise.all([connectTeam({ link, name: 'Together' }), connectTeam({ link, name: 'Together' })]);
    expect(retry.memberId).toBe(first.memberId);
    expect((await (await teamFor(first.id))!.client.team.me.query()).member.id).toBe(first.memberId);
  }, 60_000);

  it.each(['invite', 'sign-in'] as const)('recovers a lost %s response without another member or sign-in', async (kind) => {
    const { connectTeam, disconnectTeam } = await import('./connect');
    const link = kind === 'invite' ? await invitation() : (await (await owner()).team.signIns.create.mutate()).link;
    const before = (await (await owner()).team.members.query()).length;
    const fetcher = globalThis.fetch;
    const endpoint = kind === 'invite' ? '/api/team/public/join' : '/api/team/public/sign-in';
    let lost = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const response = await fetcher(url, init);
      if (!lost && String(url).endsWith(endpoint)) {
        lost = true;
        await response.arrayBuffer();
        throw new TypeError('Connection lost after admission');
      }
      return response;
    });
    await expect(connectTeam({ link, name: 'Retry' })).rejects.toThrow();
    const saved = await connectTeam({ link, name: 'Retry' });
    expect(saved.status).toBe('active');
    expect((await (await owner()).team.members.query()).length).toBe(before + (kind === 'invite' ? 1 : 0));
    expect((await connectTeam({ link, name: 'Retry' })).memberId).toBe(saved.memberId);
    // The public link alone, or a different attempt, cannot recover the sign-in.
    const input = { secret: new URL(link).hash.split('=')[1], name: 'Stranger', attemptId: 'a'.repeat(64) };
    const denied = await fetcher(`${team.url}${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(kind === 'invite' ? input : { secret: input.secret, attemptId: input.attemptId }) });
    expect(denied.ok).toBe(false);
    await disconnectTeam(saved.id);
    await expect(connectTeam({ link, name: 'Retry' })).rejects.toThrow(/used|withdrawn|expired/);
  }, 60_000);

  it('names the team first, then joins as one member, its key sealed here and nowhere else', async () => {
    const { inspectTeamLink, connectTeam } = await import('./connect');
    const link = await invitation();
    expect(await inspectTeamLink(link)).toMatchObject({ link: 'invite', state: 'valid', team: { name: 'Acme' }, connected: null });

    const connection = await connectTeam({ link, name: 'Maya' });
    expect(connection).toMatchObject({ name: 'Acme', memberName: 'Maya', role: 'member', status: 'active', url: team.url });
    const { teamConnectionView } = await import('./router');
    const view = teamConnectionView(connection);
    expect(view).toMatchObject({ id: connection.id, url: team.url });
    expect(view).not.toHaveProperty('address');

    const { readTeamKey } = await import('./credentials');
    const key = await readTeamKey(connection.id);
    expect(key?.memberId).toBe(connection.memberId);
    const sealed = fs.readFileSync(path.join(home.root, '.config', 'teams', 'credentials.json'), 'utf8');
    expect(sealed).not.toContain(key!.token);
    expect(fs.statSync(path.join(home.root, '.config', 'teams', 'credentials.json')).mode & 0o777).toBe(0o600);

    const { teamTRPC } = await import('./remote');
    const asMaya = teamTRPC(team.url, key!.token);
    expect(await asMaya.team.me.query()).toMatchObject({ member: { name: 'Maya', role: 'member' } });
    const signIns = await asMaya.team.signIns.list.query();
    expect(signIns).toEqual([expect.objectContaining({ current: true, deviceKind: 'service' })]);
  }, 60_000);

  it('refuses a second member for a team it already has, before anything is joined', async () => {
    const { connectTeam } = await import('./connect');
    await connectTeam({ link: await invitation(), name: 'Ann' });
    const before = (await (await owner()).team.members.query()).length;
    expect(await status(connectTeam({ link: await invitation(), name: 'Ann again' }))).toBe('conflict');
    expect((await (await owner()).team.members.query()).length).toBe(before);
  }, 60_000);

  it('explains a setup link and a link that is no longer valid', async () => {
    const { connectTeam, inspectTeamLink } = await import('./connect');
    expect(await status(connectTeam({ link: `${team.url}/join#setup=rtg_notarealsetupsecret` }))).toBe('invalid');
    const link = await invitation();
    await joinInBrowserWith(link, 'Used up');
    expect(await inspectTeamLink(link)).toMatchObject({ state: 'used' });
    expect(await status(connectTeam({ link, name: 'Late' }))).toBe('used');
    // Plain HTTP beyond this computer is refused in the desktop's own words.
    const { PLAIN_HTTP_LINK_REFUSED } = await import('./connect');
    await expect(inspectTeamLink('http://acme.example/join#invite=rtg_plainhttpsecret0123456789')).rejects.toThrow(PLAIN_HTTP_LINK_REFUSED);
  }, 60_000);
});

async function joinInBrowserWith(link: string, name: string) {
  const res = await fetch(`${team.url}/api/team/public/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: new URL(link).hash.split('=')[1], name }),
  });
  expect(res.status).toBe(200);
}

describe('Connect to My Ri', () => {
  it('keeps personal Home owner access after the setup browser signs out', async () => {
    const { teamTRPC } = await import('./remote');
    const ownerLink = (await (await owner()).team.signIns.create.mutate()).link;
    const response = await fetch(`${team.url}/api/team/public/sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: new URLSearchParams(new URL(ownerLink).hash.slice(1)).get('sign-in') }),
    });
    expect(response.status).toBe(200);
    const browser = await response.json() as { token: string; member: { id: string } };
    const browserClient = teamTRPC(team.url, browser.token);
    const { connectTeam, teamFor } = await import('./connect');
    const connection = await connectTeam({ link: (await browserClient.team.signIns.create.mutate()).link });
    expect(connection.memberId).toBe(browser.member.id);
    await browserClient.team.signIns.signOut.mutate();
    expect(await status(browserClient.team.me.query())).toBe('signed_out');
    const fromHome = (await teamFor(connection.id))!.client;
    expect(await fromHome.team.me.query()).toMatchObject({ member: { id: browser.member.id, role: 'owner' } });
    // Owner authority, including inviting someone, survives closing that browser.
    expect((await fromHome.team.invitations.create.mutate()).link).toContain('/join#invite=');
  }, 60_000);

  it('refuses admission for a different team before looking up or forwarding an existing key', async () => {
    const { connectTeam } = await import('./connect');
    const saved = await connectTeam({ link: await invitation(), name: 'Existing' });
    const { readTeamKey } = await import('./credentials');
    const original = (await readTeamKey(saved.id))!.token;
    const fetcher = globalThis.fetch;
    const sent: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (!String(url).startsWith('https://impostor.test/')) return fetcher(url, init);
      sent.push(new Headers(init?.headers).get('authorization') ?? '');
      if (String(url).endsWith('/preview')) return Response.json({ kind: 'team', state: 'valid', team: { id: 'different-team', name: 'New team' } });
      if (String(url).endsWith('/join')) return Response.json({ token: 'impostor-key', member: { id: saved.memberId, name: 'Existing', role: 'member' }, team: { id: saved.id, name: 'Impostor' } });
      if (String(url).endsWith('/api/home')) return Response.json({ kind: 'team', id: saved.id, name: 'Impostor' });
      return Response.json({ result: { data: { ok: true } } });
    });
    const result = await connectTeam({ link: 'https://impostor.test/join#invite=rtg_untrustedsecret0123456789', name: 'Me' }).catch((err: unknown) => err);
    expect(sent.length).toBeGreaterThanOrEqual(2);
    expect(sent.includes(`Bearer ${original}`)).toBe(false);
    expect(result).toBeInstanceOf(Error);
    expect((await readTeamKey(saved.id))!.token).toBe(original);
  }, 60_000);

  it("refuses a link from another address that claims a connected team, keeping its address and key", async () => {
    const { connectTeam } = await import('./connect');
    const saved = await connectTeam({ link: await invitation(), name: 'Held' });
    const { readTeamKey } = await import('./credentials');
    const original = (await readTeamKey(saved.id))!.token;
    const fetcher = globalThis.fetch;
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (!String(url).startsWith('https://impostor.test/')) return fetcher(url, init);
      calls.push(new URL(String(url)).pathname);
      // It claims to be the connected team, and the member it's connected as, from the first answer.
      if (String(url).endsWith('/preview')) {
        return Response.json({ kind: 'team', state: 'valid', team: { id: saved.id, name: saved.name }, member: { id: saved.memberId, name: 'Held' } });
      }
      if (String(url).endsWith('/sign-in')) return Response.json({ token: 'impostor-key', member: { id: saved.memberId, name: 'Held', role: 'member' }, team: { id: saved.id, name: saved.name } });
      if (String(url).endsWith('/api/home')) return Response.json({ kind: 'team', id: saved.id, name: saved.name });
      return Response.json({ result: { data: { ok: true } } });
    });
    const result = await connectTeam({ link: 'https://impostor.test/join#sign-in=rtg_untrustedsecret0123456789' }).catch((err: unknown) => err);
    vi.restoreAllMocks();
    expect(result).toMatchObject({ code: 'conflict', message: expect.stringContaining('disconnect it in Settings, Teams') });
    // Nothing past the preview reached it, and the connection still points at the team.
    expect(calls).toEqual(['/api/team/public/preview']);
    const q = await import('@/lib/db/queries');
    expect(q.getTeamConnection(saved.id)).toMatchObject({ url: saved.url, status: 'active' });
    expect((await readTeamKey(saved.id))!.token).toBe(original);
    // The real key still works at the real team: it wasn't signed out.
    const { teamTRPC } = await import('./remote');
    expect((await teamTRPC(team.url, original).team.me.query()).member.id).toBe(saved.memberId);
  }, 60_000);

  it('connects a team joined in a browser as the same member, and reconnecting keeps one row', async () => {
    const bo = await joinInBrowser('Bo');
    const { teamTRPC } = await import('./remote');
    const asBrowserBo = teamTRPC(team.url, bo.token);
    const { connectTeam } = await import('./connect');
    const first = await connectTeam({ link: (await asBrowserBo.team.signIns.create.mutate()).link });
    expect(first).toMatchObject({ memberId: bo.id, memberName: 'Bo' });

    const { readTeamKey } = await import('./credentials');
    const firstKey = (await readTeamKey(first.id))!.token;
    const again = await connectTeam({ link: (await asBrowserBo.team.signIns.create.mutate()).link });
    expect(again.id).toBe(first.id);
    const q = await import('@/lib/db/queries');
    expect(q.listTeamConnections()).toHaveLength(1);
    // The replaced key is signed out at the team. The browser keeps its own.
    expect(await status(teamTRPC(team.url, firstKey).team.me.query())).toBe('signed_out');
    expect(await asBrowserBo.team.me.query()).toMatchObject({ member: { id: bo.id } });
  }, 60_000);
});

describe('leaving', () => {
  it('disconnecting signs this home out at the team and clears shared content, keeping private planning', async () => {
    const { connectTeam, disconnectTeam } = await import('./connect');
    const connection = await connectTeam({ link: await invitation(), name: 'Cy' });
    const q = await import('@/lib/db/queries');
    const shared = q.saveTaskProjection({
      teamId: connection.id,
      sourceTaskId: 'team-task-1',
      fields: { title: 'Fix the login loop', description: 'Shared text', body: 'Shared body', outcome: null, hardDeadline: null, status: 'todo' },
      source: { assigned: true, addedAt: null, bodyRevision: 0, statusChangedCount: 0, updatedAt: new Date().toISOString(), syncedAt: new Date().toISOString(), area: null, assignee: null },
      state: 'active',
    });
    q.updateTask(shared.id, { userContext: 'Try the smaller fix first' }, { source: 'human' });
    const { readTeamKey } = await import('./credentials');
    const key = (await readTeamKey(connection.id))!.token;

    expect(await disconnectTeam(connection.id)).toMatchObject({ status: 'disconnected' });
    expect(await readTeamKey(connection.id)).toBeNull();
    const { teamTRPC } = await import('./remote');
    expect(await status(teamTRPC(team.url, key).team.me.query())).toBe('signed_out');
    expect(q.getTask(shared.id)).toMatchObject({
      title: 'Fix the login loop',
      body: null,
      description: null,
      status: 'archived',
      sourceState: 'unavailable',
      userContext: 'Try the smaller fix first',
    });
  }, 60_000);

  it('a team that removes the member stops this home, and an unreachable one is only an outage', async () => {
    const { connectTeam, recordTeamFailure, teamFor } = await import('./connect');
    const connection = await connectTeam({ link: await invitation(), name: 'Dee' });
    const q = await import('@/lib/db/queries');

    // The computer hosting the team is asleep: nothing is revoked or cleared.
    q.saveTeamConnection({ ...connection, url: 'http://127.0.0.1:9' });
    const asleep = await teamFor(connection.id);
    const outage = await asleep!.client.team.me.query().catch((err: unknown) => err);
    expect(recordTeamFailure(connection.id, outage)?.problem).toBe('unreachable');
    expect(q.getTeamConnection(connection.id)).toMatchObject({ status: 'active', lastError: expect.stringContaining("can't be reached") });

    q.saveTeamConnection({ ...connection, url: team.url });
    await (await owner()).team.removeMember.mutate({ id: connection.memberId });
    const removed = await (await teamFor(connection.id))!.client.team.me.query().catch((err: unknown) => err);
    expect(recordTeamFailure(connection.id, removed)?.problem).toBe('signed_out');
    expect(q.getTeamConnection(connection.id)?.status).toBe('revoked');
    expect(await teamFor(connection.id)).toBeNull();
  }, 60_000);
});
