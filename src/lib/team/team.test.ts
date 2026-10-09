/**
 * A team space end to end through the real proxy, route handlers and tRPC
 * wire format (docs/homes-spec.md §9.1-9.4, P6.1-P6.5): its identity, who
 * can reach what, getting in with each kind of grant, shared work acting
 * as the member, body revisions, and no AI anywhere.
 */

import { NextRequest } from 'next/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '@/lib/api/client';
import { apiErrorStatus } from '@/lib/api/error-status';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

const ai = vi.hoisted(() => ({ embed: vi.fn(async () => ({ embedding: new Array(1536).fill(0) })) }));
vi.mock('ai', async (importOriginal) => ({ ...(await importOriginal<typeof import('ai')>()), embed: ai.embed }));
vi.mock('@/lib/sessions/workstream', () => ({ coordinateLifecycleChange: vi.fn(async () => {}) }));
vi.mock('@/lib/sessions/workstream-runtime', () => ({ inProcessWorkstreamRuntime: {} }));
vi.mock('@/lib/executor/status-snapshot', () => ({ listRunningSessions: () => [] }));

type RouteModule = Partial<Record<'GET' | 'POST', (req: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response> | Response>>;
const ROUTES: Array<[RegExp, () => Promise<RouteModule>]> = [
  [/^\/api\/trpc\//, () => import('@/app/api/trpc/[trpc]/route') as unknown as Promise<RouteModule>],
  [/^\/api\/attachments$/, () => import('@/app/api/attachments/route') as unknown as Promise<RouteModule>],
  [/^\/api\/attachments\/([^/]+)$/, () => import('@/app/api/attachments/[fileName]/route') as unknown as Promise<RouteModule>],
  [/^\/api\/team\/public\/info$/, () => import('@/app/api/team/public/info/route') as unknown as Promise<RouteModule>],
  [/^\/api\/team\/public\/preview$/, () => import('@/app/api/team/public/preview/route') as unknown as Promise<RouteModule>],
  [/^\/api\/team\/public\/join$/, () => import('@/app/api/team/public/join/route') as unknown as Promise<RouteModule>],
  [/^\/api\/team\/public\/sign-in$/, () => import('@/app/api/team/public/sign-in/route') as unknown as Promise<RouteModule>],
  [/^\/api\/team\/public\/setup$/, () => import('@/app/api/team/public/setup/route') as unknown as Promise<RouteModule>],
  [/^\/api\/team\/host\/owner$/, () => import('@/app/api/team/host/owner/route') as unknown as Promise<RouteModule>],
  [/^\/api\/team\/host\/setup-link$/, () => import('@/app/api/team/host/setup-link/route') as unknown as Promise<RouteModule>],
  [/^\/api\/team\/host\/status$/, () => import('@/app/api/team/host/status/route') as unknown as Promise<RouteModule>],
  [/^\/api\/session$/, () => import('@/app/api/session/route') as unknown as Promise<RouteModule>],
];

/** One request through the real proxy and, when it lets it through, the real route. */
async function serve(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = new NextRequest(input instanceof Request ? input.url : String(input), { ...init, signal: init?.signal ?? undefined });
  const { proxy } = await import('@/proxy');
  const auth = proxy(request);
  if (auth.headers.get('x-middleware-next') !== '1') return auth;
  const headers = new Headers(request.headers);
  for (const [name, value] of auth.headers) {
    if (name.startsWith('x-middleware-request-')) headers.set(name.slice('x-middleware-request-'.length), value);
  }
  const path = new URL(request.url).pathname;
  const route = ROUTES.find(([pattern]) => pattern.test(path));
  if (!route) return Response.json({ error: 'no route in this test' }, { status: 599 });
  const mod = await route[1]();
  const handler = mod[request.method as 'GET' | 'POST'];
  if (!handler) return Response.json({ error: 'method' }, { status: 405 });
  const params = Promise.resolve({ fileName: route[0].exec(path)?.[1] ?? '' });
  return handler(new NextRequest(request, { headers }), { params });
}

async function post(path: string, body: unknown, token?: string): Promise<Response> {
  return serve(`http://team.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), 'user-agent': 'Mozilla/5.0 (iPhone)' },
    body: JSON.stringify(body),
  });
}

async function clientFor(token: string) {
  const { createAppTRPCClient } = await import('@/lib/trpc/client');
  return createAppTRPCClient({ url: 'http://team.test/api/trpc', transport: new ApiClient({ getToken: () => token, onUnauthorized: () => {} }) });
}

async function status(promise: Promise<unknown>): Promise<number | null> {
  try {
    await promise;
    return 200;
  } catch (err) {
    return apiErrorStatus(err) ?? null;
  }
}

function secretOf(link: string): string {
  return new URL(link).hash.split('=')[1];
}

let home: TestHome;
let hostToken: string;
let owner: { token: string; id: string };

// Load the proxy, routes and tRPC stack once, so no single test pays for it
// on a busy machine.
beforeAll(async () => {
  await Promise.all([import('@/proxy'), import('@/lib/trpc/client'), ...ROUTES.map(([, load]) => load())]);
}, 120_000);

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-team-', openDb: false });
  process.env.OPENAI_API_KEY = 'sk-test-ambient';
  ai.embed.mockClear();
  const { writeTeamIntent } = await import('@/lib/home/team-intent');
  writeTeamIntent({ creationId: 'team-create-1', name: 'Acme' });
  const { resetHomeIdentityCache, ensureHomeIdentity } = await import('@/lib/home/identity');
  const { resetAuthorityCache } = await import('@/lib/home/authority');
  resetHomeIdentityCache();
  resetAuthorityCache();
  ensureHomeIdentity();
  const { ensureLocalToken } = await import('@/lib/auth/bootstrap');
  hostToken = ensureLocalToken().plaintext;
  vi.stubGlobal('fetch', serve);
  const made = await post('/api/team/host/owner', { creationId: 'team-create-1', ownerName: 'Trey' }, hostToken);
  expect(made.status).toBe(200);
  const body = (await made.json()) as { token: string; member: { id: string } };
  owner = { token: body.token, id: body.member.id };
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.OPENAI_API_KEY;
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  (await import('@/lib/home/authority')).resetAuthorityCache();
  await home.cleanup();
});

async function invite(): Promise<string> {
  const client = await clientFor(owner.token);
  return secretOf((await client.team.invitations.create.mutate()).link);
}

async function joinAs(name: string): Promise<{ token: string; id: string }> {
  const response = await post('/api/team/public/join', { secret: await invite(), name });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { token: string; member: { id: string } };
  return { token: body.token, id: body.member.id };
}

describe('a team space', () => {
  it('is a team from its first start, named by its mark', async () => {
    const q = await import('@/lib/db/queries');
    expect(q.getHome()).toMatchObject({ kind: 'team', name: 'Acme' });
    const { authorityKind } = await import('@/lib/home/authority');
    expect(authorityKind()).toBe('team');
    const me = await (await clientFor(owner.token)).team.me.query();
    expect(me).toMatchObject({ team: { name: 'Acme', members: 1 }, member: { name: 'Trey', role: 'owner' } });
    // Its address has a name of its own, never the personal Ri's on the same account.
    const { appBeamdTunnelName } = await import('@/lib/auth/beamd-base-url');
    const configured = process.env.RI_TUNNEL_NAME;
    delete process.env.RI_TUNNEL_NAME;
    try {
      expect(appBeamdTunnelName('production')).toBe('ri-acme-ate1');
    } finally {
      if (configured !== undefined) process.env.RI_TUNNEL_NAME = configured;
    }
  });

  it('makes its first owner once: the same creation signs the same owner in again, another is refused', async () => {
    const again = (await (await post('/api/team/host/owner', { creationId: 'team-create-1', ownerName: 'Trey' }, hostToken)).json()) as {
      member: { id: string };
      created: boolean;
    };
    expect(again).toMatchObject({ member: { id: owner.id }, created: false });
    expect((await post('/api/team/host/owner', { creationId: 'team-create-2', ownerName: 'Mallory' }, hostToken)).status).toBe(409);
    const q = await import('@/lib/db/queries');
    expect(q.listMembers().map((m) => m.name)).toEqual(['Trey']);
  });

  it("keeps the host's key to administration and members to shared work", async () => {
    const host = await clientFor(hostToken);
    expect(await status(host.tasks.list.query())).toBe(403);
    expect((await post('/api/session', {}, hostToken)).status).toBe(401);

    const member = await clientFor(owner.token);
    expect(await status(member.tasks.list.query())).toBe(200);
    // Every personal procedure refuses a member, whatever it is.
    expect(await status(member.userState.list.query())).toBe(403);
    expect(await status(member.workspaces.list.query())).toBe(403);
    expect(await status(member.deck.current.query({}))).toBe(403);
    // Personal routes answer as if they weren't there, and so do the host's.
    const workspaces = await serve('http://team.test/api/workspaces', { headers: { authorization: `Bearer ${owner.token}` } });
    expect(workspaces.status).toBe(404);
    expect((await post('/api/team/host/setup-link', {}, owner.token)).status).toBe(404);
    // Nothing without a key, and a bare address says only that it's a team.
    expect((await serve('http://team.test/api/trpc/tasks.list')).status).toBe(401);
    expect(await (await serve('http://team.test/api/team/public/info')).json()).toEqual({ kind: 'team', ready: true });
  });

  it('gives a member a cookie of its own, never the personal one', async () => {
    const response = await post('/api/session', {}, owner.token);
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^ri_team_[A-Za-z0-9]{12}=/);
    expect(cookie).not.toMatch(/^ri_session=/);
  });
});

describe('getting in', () => {
  it('joins with an invitation once, naming the team before and the member after', async () => {
    const secret = await invite();
    const preview = await (await post('/api/team/public/preview', { secret, kind: 'invite' })).json();
    expect(preview).toMatchObject({ kind: 'team', state: 'valid', team: { name: 'Acme' } });

    const joined = await post('/api/team/public/join', { secret, name: '  Maya  ' });
    expect(joined.status).toBe(200);
    const body = (await joined.json()) as { token: string; member: { name: string; role: string } };
    expect(body.member).toMatchObject({ name: 'Maya', role: 'member' });
    expect(await (await clientFor(body.token)).team.me.query()).toMatchObject({ member: { name: 'Maya' } });

    // Used once: reusing it makes no second member.
    const again = await post('/api/team/public/join', { secret, name: 'Someone else' });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: 'used', message: expect.stringMatching(/already used/) });
    expect(await (await post('/api/team/public/preview', { secret, kind: 'invite' })).json()).toMatchObject({ state: 'used' });
    const q = await import('@/lib/db/queries');
    expect(q.listMembers().map((m) => m.name).sort()).toEqual(['Maya', 'Trey']);
  });

  it('explains expired, withdrawn and unknown invitations without admitting anyone', async () => {
    const q = await import('@/lib/db/queries');
    const expired = q.createTeamGrant({ kind: 'invite', createdByMemberId: owner.id, ttlMs: -1000 });
    const expiredJoin = await post('/api/team/public/join', { secret: expired.secret, name: 'Late' });
    expect(expiredJoin.status).toBe(410);
    expect(await expiredJoin.json()).toMatchObject({ error: 'expired' });

    const withdrawn = q.createTeamGrant({ kind: 'invite', createdByMemberId: owner.id });
    await (await clientFor(owner.token)).team.invitations.revoke.mutate({ id: withdrawn.grant.id });
    expect((await post('/api/team/public/join', { secret: withdrawn.secret, name: 'Nope' })).status).toBe(410);

    expect((await post('/api/team/public/join', { secret: 'rtg_not-a-real-secret-at-all', name: 'Guess' })).status).toBe(400);
    // A guess learns nothing, not even the team's name.
    expect(await (await post('/api/team/public/preview', { secret: 'rtg_not-a-real-secret-at-all', kind: 'invite' })).json()).toEqual({
      kind: 'team',
      state: 'unknown',
      team: null,
      member: null,
      expiresAt: null,
    });
    expect(q.listMembers()).toHaveLength(1);
  });

  it('lets only the owner invite people', async () => {
    const maya = await joinAs('Maya');
    expect(await status((await clientFor(maya.token)).team.invitations.create.mutate())).toBe(403);
  });

  it('signs an existing member in on another device as the same member', async () => {
    const maya = await joinAs('Maya');
    const mayaClient = await clientFor(maya.token);
    const { link } = await mayaClient.team.signIns.create.mutate();
    const signedIn = await post('/api/team/public/sign-in', { secret: secretOf(link), device: { kind: 'computer', name: 'Ri desktop' } });
    expect(signedIn.status).toBe(200);
    const laptop = (await signedIn.json()) as { token: string; member: { id: string } };
    expect(laptop.member.id).toBe(maya.id);
    const signIns = await mayaClient.team.signIns.list.query();
    expect(signIns.map((s) => s.deviceName).sort()).toEqual(['Ri desktop', 'iPhone']);

    // Signing out on one device leaves the other signed in.
    await (await clientFor(laptop.token)).team.signIns.signOut.mutate();
    expect(await status((await clientFor(laptop.token)).tasks.list.query())).toBe(401);
    expect(await status(mayaClient.tasks.list.query())).toBe(200);
  });

  it("removes a member everywhere at once, and never the last owner", async () => {
    const maya = await joinAs('Maya');
    const ownerClient = await clientFor(owner.token);
    await ownerClient.team.removeMember.mutate({ id: maya.id });
    expect(await status((await clientFor(maya.token)).tasks.list.query())).toBe(401);
    expect(await status(ownerClient.team.removeMember.mutate({ id: owner.id }))).toBe(403);
  });

  it.each([undefined, 'private-attempt-0123456789-abcdefghijk'])('finishes operator setup safely, with attempt %s', async (attemptId) => {
    // A second team, provisioned on a server with no owner yet.
    vi.unstubAllGlobals();
    await home.cleanup();
    home = await createTestHome({ prefix: 'ri-team-server-', openDb: false });
    const { writeTeamIntent } = await import('@/lib/home/team-intent');
    writeTeamIntent({ creationId: 'server-create-1' });
    (await import('@/lib/home/identity')).resetHomeIdentityCache();
    (await import('@/lib/home/authority')).resetAuthorityCache();
    (await import('@/lib/home/identity')).ensureHomeIdentity();
    hostToken = (await import('@/lib/auth/bootstrap')).ensureLocalToken().plaintext;
    vi.stubGlobal('fetch', serve);

    expect(await (await serve('http://team.test/api/team/public/info')).json()).toEqual({ kind: 'team', ready: false });
    // A stranger at the address has nothing to claim it with.
    expect((await post('/api/team/public/setup', { secret: 'rtg_guessing-the-setup-link', teamName: 'Mine', ownerName: 'Mallory' })).status).toBe(400);

    const { link } = (await (await post('/api/team/host/setup-link', {}, hostToken)).json()) as { link: string };
    const setup = await post('/api/team/public/setup', { secret: secretOf(link), attemptId, teamName: 'Family', ownerName: 'Ana' });
    expect(setup.status).toBe(200);
    const first = await setup.json();
    expect(first).toMatchObject({ member: { name: 'Ana', role: 'owner' }, team: { name: 'Family' } });
    expect((await post('/api/team/public/setup', { secret: secretOf(link), teamName: 'Again', ownerName: 'Bo' })).status).toBe(409);
    expect((await post('/api/team/host/setup-link', {}, hostToken)).status).toBe(409);
    if (attemptId) {
      const secret = secretOf(link);
      expect(await (await post('/api/team/public/preview', { secret, kind: 'setup', attemptId })).json()).toMatchObject({ state: 'valid' });
      expect(await (await post('/api/team/public/preview', { secret, kind: 'setup' })).json()).toMatchObject({ state: 'used' });
      expect((await post('/api/team/public/setup', { secret, attemptId: 'different-attempt-0123456789-abcdefghijk', teamName: 'Mine', ownerName: 'Mallory' })).status).toBe(409);
      const retry = await post('/api/team/public/setup', { secret, attemptId, teamName: 'Ignored', ownerName: 'Ignored' });
      expect(retry.status).toBe(200);
      const recovered = await retry.json();
      expect(recovered).toMatchObject({ member: first.member, team: { name: 'Family', members: 1 } });
      expect(await status((await clientFor(first.token)).team.me.query())).toBe(401);
      expect(await status((await clientFor(recovered.token)).team.me.query())).toBe(200);
      await (await clientFor(recovered.token)).team.signIns.signOut.mutate();
      expect((await post('/api/team/public/setup', { secret, attemptId, teamName: 'Family', ownerName: 'Ana' })).status).toBe(409);
      // Host recovery uses a fresh single-use sign-in for this owner, never
      // a second owner or reactivation of a revoked setup reply.
      const q = await import('@/lib/db/queries');
      const recovery = q.createTeamGrant({ kind: 'sign_in', memberId: first.member.id, createdByMemberId: null });
      const signIn = await post('/api/team/public/sign-in', { secret: recovery.secret });
      expect(signIn.status).toBe(200);
      expect(await signIn.json()).toMatchObject({ member: first.member });
    }
  });

  it('verifies the configured HTTPS address and never advertises an unreachable one as reachable', async () => {
    const q = await import('@/lib/db/queries');
    const probe = q.createTeamAddressProbe();
    expect((await post('/api/team/public/join', { secret: probe.secret, name: 'Probe cannot join' })).status).toBe(410);
    expect(await (await post('/api/team/public/preview', { secret: probe.secret, kind: 'invite' })).json()).toMatchObject({ state: 'revoked', grantId: probe.id });
    q.deleteTeamAddressProbe(probe.id);
    const client = await clientFor(owner.token);
    expect(await status(client.team.address.set.mutate({ address: 'http://not-a-team.invalid' }))).toBe(400);
    expect((await client.team.address.get.query()).address).toBeNull();
    // The fake HTTPS transport still crosses the real proxy and preview route.
    expect(await client.team.address.set.mutate({ address: 'https://team.test' })).toEqual({ address: 'https://team.test' });
    expect(await client.team.invitations.create.mutate()).toMatchObject({ reachable: true, base: 'https://team.test' });
    vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).startsWith('https://team.test/')) throw new TypeError('offline');
      return serve(input, init);
    });
    expect(await client.team.invitations.create.mutate()).toMatchObject({ reachable: false });
    expect(await status(client.team.address.set.mutate({ address: 'https://team.test' }))).toBe(400);
    expect(q.listTeamInvitations()).toHaveLength(2); // No probe grants left in history.
  });
});

describe('shared work', () => {
  it.each(['task', 'note'] as const)('requires a current body revision to restore a shared %s', async (kind) => {
    const client = await clientFor(owner.token);
    const q = await import('@/lib/db/queries');
    const record = kind === 'task'
      ? await client.tasks.create.mutate({ title: 'History', rawInput: 'History', body: 'old' })
      : await client.notes.create.mutate({ title: 'History', body: 'old' });
    const history = await client.entityVersions.list.query({ query: { entityType: kind, entityId: record.id } });
    const versionId = history.versions[0].id;
    if (kind === 'task') await client.tasks.update.mutate({ id: record.id, patch: { body: 'new' }, expectedBodyRevision: 0 });
    else await client.notes.update.mutate({ id: record.id, patch: { body: 'new' }, expectedBodyRevision: 0 });
    expect(await status(client.entityVersions.revertPost.mutate({ params: { id: versionId }, body: {} }))).toBe(400);
    expect(await status(client.entityVersions.revertPost.mutate({ params: { id: versionId }, body: { expectedBodyRevision: 0 } }))).toBe(409);
    const current = () => kind === 'task' ? q.getTask(record.id) : q.getNote(record.id);
    expect(current()).toMatchObject({ body: 'new', bodyRevision: 1 });
    expect(await status(client.entityVersions.revertPost.mutate({ params: { id: versionId }, body: { expectedBodyRevision: 1 } }))).toBe(200);
    expect(current()).toMatchObject({ body: 'old', bodyRevision: 2 });
  });
  it('acts as the member: who made it, who changed it, who moved it', async () => {
    const maya = await joinAs('Maya');
    const trey = await clientFor(owner.token);
    const task = await trey.tasks.create.mutate({ title: 'Fix the login loop', rawInput: 'Fix the login loop', assigneeMemberId: maya.id });
    await (await clientFor(maya.token)).tasks.update.mutate({ id: task.id, patch: { title: 'Fix the login loop first' } });
    await (await clientFor(maya.token)).tasks.transition.mutate({ id: task.id, command: 'start' });

    const versions = await trey.entityVersions.list.query({ query: { entityType: 'task', entityId: task.id } });
    expect(versions.versions.map((v) => [v.summary, v.actorMemberId, v.source])).toEqual([
      [null, maya.id, 'human'],
      ['Created', owner.id, 'human'],
    ]);
    const { getDb } = await import('@/lib/db');
    const { taskStatusChanges } = await import('@/lib/db/schema');
    expect(getDb().select().from(taskStatusChanges).all().map((c) => [c.command, c.actorMemberId])).toEqual([['start', maya.id]]);
    // Viewing is the person's own state, never the shared record's.
    await trey.tasks.get.query({ id: task.id });
    const q = await import('@/lib/db/queries');
    expect(q.getTask(task.id)?.lastViewedAt).toBeNull();
    expect((await trey.tasks.list.query({ assigneeMemberId: maya.id })).map((t) => t.id)).toEqual([task.id]);
  });

  it('acts only as the member its key names, whatever the request claims', async () => {
    const maya = await joinAs('Maya');
    const { API_KEY_ID_HEADER, API_KEY_SCOPE_HEADER, MEMBER_ID_HEADER, MEMBER_ROLE_HEADER } = await import('@/lib/auth/request-key');
    // Maya's requests claim to be the owner, by every header the proxy forwards.
    vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.set(MEMBER_ID_HEADER, owner.id);
      headers.set(MEMBER_ROLE_HEADER, 'owner');
      headers.set(API_KEY_SCOPE_HEADER, 'host');
      headers.set(API_KEY_ID_HEADER, 'forged-key');
      return serve(input, { ...init, headers });
    });
    const forged = await clientFor(maya.token);
    expect(await status(forged.team.invitations.create.mutate())).toBe(403);
    expect(await forged.team.me.query()).toMatchObject({ member: { id: maya.id, role: 'member' } });
    expect((await post('/api/team/host/setup-link', {}, maya.token)).status).toBe(404);
    const task = await forged.tasks.create.mutate({ title: 'Mine', rawInput: 'Mine' });
    // Naming someone else as the actor in the payload changes nothing either.
    expect(await status(forged.tasks.update.mutate({ id: task.id, patch: { title: 'Still mine', actorMemberId: owner.id } as never }))).toBe(400);
    vi.stubGlobal('fetch', serve);
    const versions = await (await clientFor(owner.token)).entityVersions.list.query({ query: { entityType: 'task', entityId: task.id } });
    expect(versions.versions.map((v) => v.actorMemberId)).toEqual([maya.id]);
  });

  it("keeps a team's records to the fields it shares, and assigns only its members", async () => {
    const trey = await clientFor(owner.token);
    expect(await status(trey.tasks.create.mutate({ title: 'Plan', rawInput: 'Plan', energy: 'deep' }))).toBe(400);
    const task = await trey.tasks.create.mutate({ title: 'Plan', rawInput: 'Plan' });
    expect(await status(trey.tasks.update.mutate({ id: task.id, patch: { effort: 'large' } }))).toBe(400);
    expect(await status(trey.tasks.update.mutate({ id: task.id, patch: { assigneeMemberId: 'nobody' } }))).toBe(400);
    const maya = await joinAs('Maya');
    await trey.team.removeMember.mutate({ id: maya.id });
    expect(await status(trey.tasks.update.mutate({ id: task.id, patch: { assigneeMemberId: maya.id } }))).toBe(400);
    expect(await status(trey.notes.create.mutate({ body: 'x', taskId: task.id }))).toBe(400);
  });

  it('refuses a stale shared body with the current text, so nobody overwrites anyone', async () => {
    const maya = await joinAs('Maya');
    const trey = await clientFor(owner.token);
    const mayaClient = await clientFor(maya.token);
    const note = await trey.notes.create.mutate({ title: 'Plan', body: 'Draft' });
    expect(note.bodyRevision).toBe(0);
    // A shared body says which version it edited.
    expect(await status(trey.notes.update.mutate({ id: note.id, patch: { body: 'Unchecked' } }))).toBe(400);

    const first = await trey.notes.update.mutate({ id: note.id, patch: { body: 'Trey edit' }, expectedBodyRevision: 0 });
    expect(first.bodyRevision).toBe(1);
    let conflict: unknown;
    try {
      await mayaClient.notes.update.mutate({ id: note.id, patch: { body: 'Maya edit' }, expectedBodyRevision: 0 });
    } catch (err) {
      conflict = err;
    }
    expect(apiErrorStatus(conflict)).toBe(409);
    const { apiErrorDetails } = await import('@/lib/api/client');
    expect(apiErrorDetails(conflict)).toMatchObject({ body: 'Trey edit', bodyRevision: 1 });
    const q = await import('@/lib/db/queries');
    expect(q.getNote(note.id)?.body).toBe('Trey edit');
    // Choosing to keep their text, against the revision they now have.
    const kept = await mayaClient.notes.update.mutate({ id: note.id, patch: { body: 'Maya edit' }, expectedBodyRevision: 1 });
    expect(kept).toMatchObject({ body: 'Maya edit', bodyRevision: 2 });

    const task = await trey.tasks.create.mutate({ title: 'Ship', rawInput: 'Ship', body: 'v0' });
    await trey.tasks.update.mutate({ id: task.id, patch: { body: 'v1' }, expectedBodyRevision: 0 });
    expect(await status(mayaClient.tasks.update.mutate({ id: task.id, patch: { body: 'stale' }, expectedBodyRevision: 0 }))).toBe(409);
  });

  it('archives shared work for everyone, and lets only the owner delete it', async () => {
    const maya = await joinAs('Maya');
    const trey = await clientFor(owner.token);
    const task = await trey.tasks.create.mutate({ title: 'Old', rawInput: 'Old' });
    expect(await status((await clientFor(maya.token)).tasks.delete.mutate({ id: task.id }))).toBe(403);
    await (await clientFor(maya.token)).tasks.transition.mutate({ id: task.id, command: 'archive' });
    await trey.tasks.delete.mutate({ id: task.id });
  });

  it("organizes shared work in the team's Areas, which every member can make and none can make private", async () => {
    const maya = await joinAs('Maya');
    const mayaClient = await clientFor(maya.token);
    const area = await mayaClient.areas.create.mutate({ name: 'Garden' });
    await mayaClient.areas.update.mutate({ id: area.id, patch: { name: 'Garden and yard', emoji: '🌱' } });
    expect(await status(mayaClient.areas.create.mutate({ name: 'Mine', userContext: 'private notes for my assistant' }))).toBe(400);
    expect(await status(mayaClient.areas.update.mutate({ id: area.id, patch: { userContext: 'x' } }))).toBe(400);
    const trey = await clientFor(owner.token);
    const task = await trey.tasks.create.mutate({ title: 'Mow', rawInput: 'Mow', areaId: area.id });
    expect((await trey.areas.list.query()).map((a) => a.name)).toEqual(['Garden and yard']);
    expect((await mayaClient.tasks.list.query({ areaId: area.id })).map((t) => t.id)).toEqual([task.id]);
    // Retiring an Area is the same for everyone, and grants or hides nothing.
    await mayaClient.areas.update.mutate({ id: area.id, patch: { status: 'archived' } });
    expect(await trey.areas.list.query()).toEqual([]);
    expect((await trey.tasks.get.query({ id: task.id })).areaId).toBe(area.id);
  });

  it("shares a file on shared work with the team's members, and nobody else", async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const upload = (token: string) => {
      const form = new FormData();
      form.append('file', new Blob([png], { type: 'image/png' }), 'floor plan.png');
      return serve('http://team.test/api/attachments', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
    };
    expect((await upload(hostToken)).status).toBe(403);
    const uploaded = await upload(owner.token);
    expect(uploaded.status).toBe(201);
    const attachment = (await uploaded.json()) as { fileName: string; originalName: string; mimeType: string };
    expect(attachment).toMatchObject({ originalName: 'floor plan.png', mimeType: 'image/png' });

    // The body names the file, and the upload's own record rides with that save.
    const trey = await clientFor(owner.token);
    const note = await trey.notes.create.mutate({ title: 'Move', body: '' });
    await trey.notes.update.mutate({
      id: note.id,
      patch: { body: `![floor plan.png](/api/attachments/${attachment.fileName})`, attachments: [attachment as never] },
      expectedBodyRevision: 0,
    });
    const q = await import('@/lib/db/queries');
    expect(q.getNote(note.id)?.attachments).toMatchObject([{ fileName: attachment.fileName, originalName: 'floor plan.png', mimeType: 'image/png' }]);

    const read = (token?: string) =>
      serve(`http://team.test/api/attachments/${attachment.fileName}`, token ? { headers: { authorization: `Bearer ${token}` } } : {});
    const maya = await joinAs('Maya');
    const got = await read(maya.token);
    expect(got.status).toBe(200);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(png);
    expect((await read()).status).toBe(401);
    expect((await read(hostToken)).status).toBe(403);
    await trey.team.removeMember.mutate({ id: maya.id });
    expect((await read(maya.token)).status).toBe(401);
  });

  it('searches by keyword only, ambient key or not', async () => {
    const trey = await clientFor(owner.token);
    await trey.tasks.create.mutate({ title: 'Quarterly invoices', rawInput: 'Quarterly invoices' });
    const hits = await trey.search.list.query({ query: { q: 'invoices' } });
    expect(hits.map((h) => (h as { title?: string }).title)).toEqual(['Quarterly invoices']);
    expect(ai.embed).not.toHaveBeenCalled();
  });
});

describe('no AI in a team', () => {
  it('makes no model call and starts no personal work, with an ambient API key present', async () => {
    const trey = await clientFor(owner.token);
    await trey.tasks.create.mutate({ title: 'Embed me?', rawInput: 'Embed me?', body: 'no' });
    await trey.notes.create.mutate({ body: 'Nor me' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ai.embed).not.toHaveBeenCalled();

    const boundary = /isn't part of a team space/;
    const { runHarnessText } = await import('@/lib/harness/one-shot');
    await expect(runHarnessText({ label: 'test', prompt: 'hi' })).rejects.toThrow(boundary);
    const { generateEmbedding } = await import('@/lib/embeddings/embed');
    await expect(generateEmbedding('hi')).rejects.toThrow(boundary);
    const { getHarnessRuntime } = await import('@/lib/harness/runtime');
    await expect(getHarnessRuntime('claude')).rejects.toThrow(boundary);
    const { discoverExternalAgentSessions, syncAllImportedSessions } = await import('@/lib/import/external-agents');
    await expect(discoverExternalAgentSessions()).rejects.toThrow(boundary);
    await expect(syncAllImportedSessions()).rejects.toThrow(boundary);
    const { dispatch } = await import('@/lib/executor/adapter');
    await expect(dispatch('any-chat', 'hello')).rejects.toThrow(boundary);
    const { startScheduler } = await import('@/lib/scheduler/runner');
    expect(() => startScheduler()).toThrow(boundary);
    const { ensureTodaysDeck } = await import('@/lib/deck/ensure-todays-deck');
    await expect(ensureTodaysDeck()).rejects.toThrow(boundary);
    const { localApps } = await import('@/lib/local-apps/service');
    expect(() => localApps().initialize()).toThrow(/team space|not enabled/);
  });
});
