import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { closeAllSessions, _resetExecutorState } from '@/lib/runner/local-runner';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
const status = vi.hoisted(() => ({ pending: [] as string[], running: [] as string[], background: [] as string[] }));
vi.mock('@/lib/executor/status-snapshot', () => ({ listSessionsWithPending: () => status.pending, listRunningSessions: () => status.running, listBackgroundTaskSessions: () => status.background }));
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
import { API_PROTOCOL, API_PROTOCOL_HEADER } from '@/lib/releases/api-contract';

let fake: FakeHarness;
let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
beforeAll(preloadTeamRoutes);
beforeEach(async () => { vi.stubEnv('RI_MIRROR_DISABLED', '1'); fixture = await createTeamExecutionFixture(); fake = installFakeHarness('codex'); fake.modelId = 'gpt-6.1-sol'; vi.stubGlobal('fetch', serveTeam); status.pending = []; status.running = []; status.background = []; });
afterEach(async () => { await closeAllSessions(); _resetExecutorState(); fake.restore(); await fixture.cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('shares the ordinary rail while showing only authorized work and prompts the member can answer', async () => {
  const owner = await teamTrpc(fixture.owner.token.plaintext), member = await teamTrpc(fixture.member.token.plaintext);
  expect((await owner.workspaces.chatGet.query({ params: { id: fixture.workspace.id } })).session).toBeNull();
  expect(q.listMainChats(fixture.workspace.id)).toHaveLength(0);
  const main = await owner.workspaces.chatNewPost.mutate({ params: { id: fixture.workspace.id }, body: {} });
  const execution = q.createExecutionWithChat({ workspaceId: fixture.workspace.id, createdByMemberId: fixture.owner.member.id, surfaceKind: q.TEAM_CHAT_SURFACE, harness: 'codex', model: 'gpt-6.1-sol', label: 'Shared project' });
  q.createPlacement({ executionId: execution.execution.id, deviceId: q.getHome()!.hostDeviceId, startReason: 'created', worktreePath: fixture.workspace.cwd });
  q.acceptTeamChatSend({ chatId: execution.session.id, memberId: fixture.owner.member.id, requestingApiKeyId: fixture.owner.key.id, clientSendId: 'owner-pending-fixture', text: 'Work' });
  q.claimNextTeamChatTurn(execution.session.id);
  const other = q.createWorkspace({ name: 'Unconfigured', cwd: '/private/host', isGit: false });
  const inaccessible = q.createExecutionWithChat({ workspaceId: other.id, harness: 'codex', label: 'Unshared internal chat' });
  status.pending = [execution.session.id, inaccessible.session.id]; status.running = [inaccessible.session.id]; status.background = [inaccessible.session.id];
  const rail = await member.sessions.railGet.query({});
  expect(rail.sessions.map(row => row.id)).toEqual([execution.session.id]);
  expect(rail.mainChats.map(row => row.id)).toEqual([main.session!.id]);
  expect(rail.runningSessionIds).toContain(execution.session.id);
  expect(rail.pendingSessionIds).toContain(execution.session.id);
  expect(JSON.stringify(rail)).not.toContain(inaccessible.session.id);
  expect((await owner.sessions.railGet.query({})).pendingSessionIds).toEqual([execution.session.id]);
  const headers = { authorization: 'Bearer ' + fixture.member.token.plaintext, [API_PROTOCOL_HEADER]: String(API_PROTOCOL) };
  expect((await serveTeam('http://team.test/api/sessions/rail', { headers })).status).toBe(200);
});

it('reports the pinned destination without host alternatives and rechecks a removed member on raw and typed reads', async () => {
  const member = await teamTrpc(fixture.member.token.plaintext);
  const params = { id: fixture.workspace.id };
  expect(await member.workspaces.runOnGet.query({ params })).toMatchObject({ defaultId: q.getHome()!.hostDeviceId, choices: [{ deviceId: q.getHome()!.hostDeviceId, isHome: true, needsSetup: false }] });
  const headers = { authorization: 'Bearer ' + fixture.member.token.plaintext, [API_PROTOCOL_HEADER]: String(API_PROTOCOL), 'content-type': 'application/json', 'x-ri-member-role': 'owner' };
  const changed = await serveTeam(`http://team.test/api/workspaces/${params.id}/run-on`, { method: 'PUT', headers, body: JSON.stringify({ defaultDeviceId: q.getHome()!.hostDeviceId }) });
  expect(changed.status).toBe(403);
  expect(q.getWorkspace(params.id)?.defaultDeviceId).toBe(q.getHome()!.hostDeviceId);
  q.removeMember(fixture.member.member.id);
  await expect(member.sessions.railGet.query({})).rejects.toThrow();
  expect((await serveTeam(`http://team.test/api/workspaces/${params.id}/run-on`, { headers })).status).toBe(401);
});
