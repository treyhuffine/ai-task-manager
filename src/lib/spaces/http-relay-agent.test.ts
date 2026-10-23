/**
 * Probe: the personal Home's HTTP relay (/api/space/<team>/trpc/...) refuses a
 * disclosed agent (x-ri-session) only for sessions.pendingInputRequestIdPost.
 * Other person-only authority (widening a chat's permission mode, launching
 * an unrestricted execution) is forwarded with the member key and no session
 * identity, so the Team treats the disclosed agent as the person.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { API_KEY_ID_HEADER, API_KEY_SCOPE_HEADER } from '@/lib/auth/request-key';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { startTeamProcess, type TeamProcess } from '@/test/fixtures/team-process';

let team: TeamProcess;
let teamRoot: string;
let home: TestHome;

beforeAll(async () => {
  teamRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-probe-perm-relay-team-'));
  team = await startTeamProcess(teamRoot, 'Acme', 'Trey', { execution: true });
}, 120_000);
afterAll(async () => { await team?.stop(); fs.rmSync(teamRoot, { recursive: true, force: true }); });
beforeEach(async () => { home = await createTestHome({ prefix: 'ri-probe-perm-relay-home-' }); });
afterEach(async () => { vi.restoreAllMocks(); await home.cleanup(); });

async function owner() {
  const { teamTRPC } = await import('@/lib/spaces/remote');
  return teamTRPC(team.url, team.ownerToken);
}
async function connected(name: string) {
  const { connectTeam } = await import('@/lib/spaces/connect');
  return connectTeam({ link: (await (await owner()).team.invitations.create.mutate()).link, name });
}
async function viaHome(teamId: string, rest: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) {
  const { GET, POST } = await import('@/app/api/space/[teamId]/[...path]/route');
  const url = new URL(`http://my-ri.test/api/space/${teamId}/${rest}`);
  const headers = new Headers(init.headers);
  headers.set(API_KEY_ID_HEADER, 'personal-key');
  headers.set(API_KEY_SCOPE_HEADER, 'viewer');
  headers.set('content-type', 'application/json');
  const request = new NextRequest(url, { method: init.method ?? 'GET', headers, body: init.body });
  const handler = (init.method ?? 'GET') === 'POST' ? POST : GET;
  return handler(request, { params: Promise.resolve({ teamId, path: url.pathname.split('/').slice(4).map(decodeURIComponent) }) });
}

it('the HTTP relay refuses disclosed agents on prompt, permission and launch paths', async () => {
  const connection = await connected('Maya');
  const o = await owner();
  const created = await o.workspaces.sessionsPost.mutate({ params: { id: team.workspaceId! }, body: { harness: 'claude', permissionMode: 'ask', label: 'Ask chat' } }) as { id: string; permissionMode: string };
  expect(created.permissionMode).toBe('ask');

  // Control: the relay does refuse the prompt-answer procedure for a disclosed agent.
  const refused = await viaHome(connection.id, 'trpc/sessions.pendingInputRequestIdPost', { method: 'POST', headers: { 'x-ri-session': 'personal-signed-agent' }, body: JSON.stringify({ params: { id: created.id, requestId: 'x' }, body: { allow: true } }) });
  expect(refused.status).toBe(403);

  // Disclosed agent: widening ask -> auto_all should need a signed-in person.
  const widened = await viaHome(connection.id, 'trpc/sessions.update', { method: 'POST', headers: { 'x-ri-session': 'personal-signed-agent' }, body: JSON.stringify({ params: { id: created.id }, body: { permissionMode: 'auto_all' } }) });
  await widened.body?.cancel();
  const after = await o.sessions.get.query({ params: { id: created.id } }) as { permissionMode: string };
  expect.soft(widened.status, 'disclosed agent widening should be refused').toBe(403);
  expect.soft(after.permissionMode).toBe('ask');
  const person = await viaHome(connection.id, 'trpc/sessions.update', { method: 'POST', body: JSON.stringify({ params: { id: created.id }, body: { permissionMode: 'auto_all' } }) });
  expect(person.status).toBe(200);
  expect((await o.sessions.get.query({ params: { id: created.id } })).permissionMode).toBe('auto_all');

  // Disclosed agent: launch a fresh unrestricted execution through the relay.
  const launched = await viaHome(connection.id, 'trpc/workspaces.sessionsPost', { method: 'POST', headers: { 'x-ri-session': 'personal-signed-agent' }, body: JSON.stringify({ params: { id: team.workspaceId! }, body: { harness: 'claude', permissionMode: 'auto_all', label: 'Agent launch' } }) });
  await launched.body?.cancel();
  expect.soft(launched.status, 'disclosed agent auto_all launch should be refused').toBe(403);
}, 120_000);

it('an owner connection cannot promote a disclosed agent to a person', async () => {
  const o = await owner();
  const link = await o.team.signIns.create.mutate() as { link: string };
  const { connectTeam } = await import('@/lib/spaces/connect');
  const connection = await connectTeam({ link: link.link });
  expect(connection.role ?? 'owner').toBe('owner');
  const before = await o.team.ai.status.query();
  expect(before.enabled).toBe(true);
  const res = await viaHome(connection.id, 'trpc/team.ai.setEnabled', { method: 'POST', headers: { 'x-ri-session': 'personal-signed-agent' }, body: JSON.stringify({ enabled: false }) });
  const after = await o.team.ai.status.query();
  expect.soft(res.status, 'manageSignIns is person-only').toBe(403);
  expect.soft(after.enabled).toBe(true);
  const person = await viaHome(connection.id, 'trpc/team.ai.setEnabled', { method: 'POST', body: JSON.stringify({ enabled: false }) });
  expect(person.status).toBe(200);
  expect((await o.team.ai.status.query()).enabled).toBe(false);
  // restore for other tests
  await o.team.ai.setEnabled.mutate({ enabled: true });
}, 120_000);