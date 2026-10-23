import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import { API_PROTOCOL, API_PROTOCOL_HEADER } from '@/lib/releases/api-contract';
import * as q from '@/lib/db/queries';

let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
beforeAll(preloadTeamRoutes);
beforeEach(async () => { vi.stubEnv('RI_MIRROR_DISABLED', '1'); fixture = await createTeamExecutionFixture(); vi.stubGlobal('fetch', serveTeam); });
afterEach(async () => { await fixture.cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('returns only authorized shared task workstreams through typed and exact REST operations, including AI-off history', async () => {
  const task = q.createTask({ title: 'Team task', rawInput: 'Team task' });
  const created = q.createExecutionWithChat({ workspaceId: fixture.workspace.id, createdByMemberId: fixture.member.member.id, surfaceKind: q.TEAM_CHAT_SURFACE, harness: 'codex', label: 'Shared work', model: 'gpt-6.1-sol', startTask: { taskId: task.id, idempotencyKey: 'team-task-start' } });
  q.createPlacement({ executionId: created.execution.id, deviceId: q.getHome()!.hostDeviceId, startReason: 'created', worktreePath: fixture.workspace.cwd });
  const host = q.createWorkspace({ name: 'Unconfigured host', cwd: '/private/host', isGit: false });
  q.createExecutionWithChat({ workspaceId: host.id, harness: 'codex', label: 'Private host work', model: 'gpt-6.1-sol', startTask: { taskId: task.id, idempotencyKey: 'old-task-start' } });
  const client = await teamTrpc(fixture.member.token.plaintext);
  const read = () => client.tasks.continueTargetsGet.query({ params: { id: task.id } });
  expect(await read()).toEqual([{ executionId: created.execution.id, sessionId: created.session.id, label: 'Shared work' }]);
  const headers = { authorization: 'Bearer ' + fixture.member.token.plaintext, [API_PROTOCOL_HEADER]: String(API_PROTOCOL) };
  const raw = await serveTeam(`http://team.test/api/tasks/${task.id}/continue-targets`, { headers });
  expect(raw.status, await raw.clone().text()).toBe(200); expect(await raw.json()).toEqual(await read());
  q.saveTeamAiSettings({ enabled: false }, fixture.owner.member.id);
  expect(await read()).toHaveLength(1);
  q.revokeApiKey(fixture.member.key.id, 'Signed out');
  await expect(read()).rejects.toThrow();
  expect((await serveTeam(`http://team.test/api/tasks/${task.id}/continue-targets`, { headers })).status).toBe(401);
});
