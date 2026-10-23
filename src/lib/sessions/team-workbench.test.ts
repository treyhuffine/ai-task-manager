/** Preview admission reuses ordinary operations and fails before calling the preview engine. */
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
const previews = vi.hoisted(() => ({ status: vi.fn(), start: vi.fn(), stop: vi.fn(), logs: vi.fn() }));
vi.mock('@/lib/preview/service', async original => ({ ...await original<typeof import('@/lib/preview/service')>(), getPreviewState: previews.status, resolvePreview: previews.start, stopPreview: previews.stop, previewLogs: previews.logs }));
let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>, saved: ReturnType<typeof q.createExecutionWithChat>;
beforeAll(preloadTeamRoutes);
beforeEach(async () => { fixture = await createTeamExecutionFixture(); vi.stubGlobal('fetch', serveTeam); vi.clearAllMocks(); saved = q.createExecutionWithChat({ workspaceId: fixture.workspace.id, harness: 'claude', label: 'Preview', surfaceKind: q.TEAM_CHAT_SURFACE });
  q.createPlacement({ executionId: saved.execution.id, deviceId: q.getHome()!.hostDeviceId, startReason: 'created', worktreePath: fixture.workspace.cwd });
  previews.status.mockReturnValue({ executionId: saved.execution.id, serverStatus: 'running', localUrl: 'http://localhost:45000', remoteUrl: null }); previews.start.mockImplementation(async () => previews.status()); previews.logs.mockReturnValue({ entries: [], cursor: 0 });
});
afterEach(async () => { await fixture.cleanup(); vi.unstubAllGlobals(); });
it('lets members use ordinary preview start, stop, logs and status with AI off', async () => {
  const member = await teamTrpc(fixture.member.token.plaintext); const params = { id: saved.execution.id };
  q.saveTeamAiSettings({ enabled: false }, fixture.owner.member.id);
  expect(await member.executions.previewStatusGet.query({ params })).toMatchObject({ serverStatus: 'running' });
  await member.executions.previewStartPost.mutate({ params, body: {} }); await member.executions.previewLogsGet.query({ params }); await member.executions.previewStopPost.mutate({ params, body: {} });
  expect(previews.start).toHaveBeenCalledOnce(); expect(previews.stop).toHaveBeenCalledOnce(); expect(previews.logs).toHaveBeenCalledOnce();
});
it('refuses a removed member and another-device execution before preview work starts', async () => {
  const member = await teamTrpc(fixture.member.token.plaintext); const device = q.createDevice({ name: 'Other', kind: 'computer' });
  const other = q.createExecutionWithChat({ workspaceId: fixture.workspace.id, harness: 'claude', label: 'Elsewhere', surfaceKind: q.TEAM_CHAT_SURFACE });
  q.createPlacement({ executionId: other.execution.id, deviceId: device.id, startReason: 'created' });
  await expect(member.executions.previewStartPost.mutate({ params: { id: other.execution.id }, body: {} })).rejects.toMatchObject({ data: { httpStatus: 403 } });
  q.removeMember(fixture.member.member.id); await expect(member.executions.previewStartPost.mutate({ params: { id: saved.execution.id }, body: {} })).rejects.toThrow(/401/);
  expect(previews.start).not.toHaveBeenCalled();
});
