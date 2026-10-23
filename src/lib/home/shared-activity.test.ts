/** Actual shared tRPC/SQLite admission, synthetic Git and preview side effects. */
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
const effects = vi.hoisted(() => ({ git: vi.fn(), preview: vi.fn(), restore: vi.fn() }));
vi.mock('@/lib/executor/owner-git', () => ({ gitOnOwner: effects.git }));
vi.mock('@/lib/preview/service', async original => ({ ...await original<typeof import('@/lib/preview/service')>(), resolvePreview: effects.preview, restoreWorkspacePreviews: effects.restore }));
let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
beforeAll(preloadTeamRoutes, 120_000);
beforeEach(async () => {
  fixture = await createTeamExecutionFixture(); vi.stubGlobal('fetch', serveTeam);
  effects.git.mockReset().mockResolvedValue({ ok: true });
  effects.preview.mockReset().mockResolvedValue({ status: 'running', url: 'http://127.0.0.1:54321' });
  effects.restore.mockReset().mockResolvedValue([]);
});
afterEach(async () => { vi.unstubAllGlobals(); await fixture.cleanup(); });
it('attributes successful Git and preview controls to the member through the ordinary shared operations', async () => {
  const client = await teamTrpc(fixture.member.token.plaintext);
  const created = q.createExecutionWithChat({ label: null, workspaceId: fixture.workspace.id, harness: 'claude', surfaceKind: q.TEAM_CHAT_SURFACE, createdByMemberId: fixture.owner.member.id, worktreePath: fixture.workspace.cwd });
  const params = { id: created.session.id };
  await client.sessions.pushPost.mutate({ params, body: {} });
  await client.sessions.pullBasePost.mutate({ params, body: {} });
  await client.sessions.pullUpstreamPost.mutate({ params, body: { strategy: 'merge' } });
  await client.executions.previewStartPost.mutate({ params: { id: created.execution.id }, body: {} });
  await client.workspaces.previewRestoreSetPost.mutate({ params: { id: fixture.workspace.id }, body: {} });
  const activity = q.listTeamActivity(fixture.workspace.id);
  expect(activity.map(row => row.operation)).toEqual(expect.arrayContaining(['push', 'pull_base', 'pull_upstream', 'preview_start', 'preview_restore']));
  expect(activity).toHaveLength(5);
  expect(activity.every(row => row.memberId === fixture.member.member.id && row.apiKeyId === fixture.member.key.id)).toBe(true);
  effects.git.mockResolvedValue({ ok: false, response: new Response(JSON.stringify({ error: 'failure', message: 'Synthetic failure' })) });
  await expect(client.sessions.pushPost.mutate({ params, body: {} })).rejects.toThrow();
  expect(q.listTeamActivity(fixture.workspace.id)).toHaveLength(5);
});
