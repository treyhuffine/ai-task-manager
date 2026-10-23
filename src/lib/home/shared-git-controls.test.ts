/** Real procedures and Home authority, with synthetic Git/GitHub side effects. */
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
import { installFakeHarness } from '@/test/fixtures/fake-harness';
import { settledTeamAi, stopTeamAiWork } from '@/lib/team/ai/chat';
import { closeAllSessions } from '@/lib/runner/local-runner';
const effects = vi.hoisted(() => ({ git: vi.fn(), prs: vi.fn(), detail: vi.fn(), status: vi.fn(), branches: vi.fn(), pull: vi.fn(), denied: new Set<string>() }));
vi.mock('@/lib/team/capabilities', async original => {
  const actual = await original<typeof import('@/lib/team/capabilities')>();
  return { ...actual, hasTeamCapability: (...args: Parameters<typeof actual.hasTeamCapability>) => !effects.denied.has(args[1]) && actual.hasTeamCapability(...args) };
});
vi.mock('@/lib/github/execution-github', async original => ({ ...await original<typeof import('@/lib/github/execution-github')>(), runGithub: effects.git }));
vi.mock('@/lib/workspaces', async original => ({ ...await original<typeof import('@/lib/workspaces')>(), getWorkspaceBaseStatus: effects.status, listWorkspaceBranches: effects.branches, pullWorkspaceBase: effects.pull }));
vi.mock('@agentex/github', async original => ({ ...await original<typeof import('@agentex/github')>(), github: { repo: () => ({ listPRs: effects.prs, getPR: effects.detail }) } }));
vi.mock('@/lib/executor/owner-files', async original => ({ ...await original<typeof import('@/lib/executor/owner-files')>(), executionDiff: vi.fn(async () => ({ ok: true, diff: { files: [] } })) }));
vi.mock('@/lib/harness/runtime', async original => {
  const { fakeHarnessRuntime, fakeHarnessAuth } = await import('@/test/fixtures/harness-runtime');
  return { ...await original<typeof import('@/lib/harness/runtime')>(), getHarnessRuntime: fakeHarnessRuntime, resolveHarnessAuth: fakeHarnessAuth };
});
let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
beforeAll(preloadTeamRoutes, 120_000);
beforeEach(async () => {
  fixture = await createTeamExecutionFixture(); vi.stubGlobal('fetch', serveTeam); vi.clearAllMocks(); effects.denied.clear();
  q.updateWorkspace(fixture.workspace.id, { isGit: true });
  effects.git.mockResolvedValue({ status: 200, body: { ok: true, enabled: true, prNumber: 7, url: 'https://example.invalid/pr/7' } });
  effects.prs.mockResolvedValue([{ number: 7 }]); effects.detail.mockResolvedValue({ number: 7, body: 'PR context' });
  effects.status.mockResolvedValue({ behind: 0 }); effects.branches.mockResolvedValue(['main']); effects.pull.mockResolvedValue({ ok: true });
});

it('Open PR uses the ordinary shared member queue with capability checks and one attributed receipt', async () => {
  const fake = installFakeHarness('claude');
  try {
    q.saveTeamAiSettings({ harness: 'claude', model: fake.modelId }, fixture.owner.member.id);
    q.updateWorkspace(fixture.workspace.id, { baseBranch: 'main' });
    const shared = q.createExecutionWithChat({ workspaceId: fixture.workspace.id, harness: 'claude', label: 'PR work', branchName: 'feature', worktreePath: fixture.workspace.cwd, surfaceKind: q.TEAM_CHAT_SURFACE });
    const client = await teamTrpc(fixture.member.token.plaintext);
    const request = { params: { id: shared.session.id }, body: { requestId: crypto.randomUUID() } };
    effects.denied.add('openAgentTerminal');
    await expect(client.sessions.prPost.mutate(request)).rejects.toThrow(/cannot perform/);
    expect(fake.sessions).toEqual([]);
    effects.denied.clear();
    const result = await client.sessions.prPost.mutate(request);
    expect(result).toMatchObject({ ok: true, eventId: expect.any(String) });
    await settledTeamAi();
    expect(fake.latest().messages).toHaveLength(1);
    expect(fake.latest().messages[0]).toContain('gh pr create');
    expect(await client.sessions.prPost.mutate(request)).toMatchObject({ ok: true, replayed: true, eventId: result.eventId });
    expect(q.listTeamActivity(fixture.workspace.id).filter(row => row.operation === 'open_pull_request')).toMatchObject([{ memberId: fixture.member.member.id, kind: 'git_change' }]);
  } finally { await stopTeamAiWork({}, 'Fixture ended.'); await settledTeamAi(); await closeAllSessions(); fake.restore(); }
});
afterEach(async () => { effects.denied.clear(); await fixture.cleanup(); vi.unstubAllGlobals(); });
it('shares merge, auto-merge and launcher Git controls with member attribution', async () => {
  const client = await teamTrpc(fixture.member.token.plaintext);
  const shared = q.createExecutionWithChat({ workspaceId: fixture.workspace.id, harness: 'claude', label: 'Shared', branchName: 'feature', prNumber: 7, surfaceKind: q.TEAM_CHAT_SURFACE });
  const params = { id: shared.session.id }, workspace = { id: fixture.workspace.id };
  expect(await client.sessions.mergePost.mutate({ params, body: {} })).toMatchObject({ ok: true });
  expect(await client.sessions.autoMergePost.mutate({ params, body: { enable: true } })).toMatchObject({ enabled: true });
  expect(await client.workspaces.githubPrsGet.query({ params: workspace })).toEqual([{ number: 7 }]);
  expect(await client.workspaces.githubPrsNumberGet.query({ params: { ...workspace, number: '7' } })).toMatchObject({ body: 'PR context' });
  expect(await client.workspaces.branchesGet.query({ params: workspace })).toEqual(['main']);
  expect(await client.workspaces.baseStatusGet.query({ params: workspace })).toMatchObject({ behind: 0 });
  await client.workspaces.pullBasePost.mutate({ params: workspace, body: {} });
  expect(q.listTeamActivity(fixture.workspace.id).map(row => row.operation)).toEqual(expect.arrayContaining(['merge', 'enable_auto_merge', 'pull_base']));
  expect(q.listTeamActivity(fixture.workspace.id).every(row => row.memberId === fixture.member.member.id)).toBe(true);
  effects.denied.add('openAgentTerminal');
  await expect(client.sessions.mergePost.mutate({ params, body: {} })).rejects.toThrow(/cannot perform/);
  expect(effects.git).toHaveBeenCalledTimes(2);
  const privateChat = q.createExecutionWithChat({ workspaceId: fixture.workspace.id, harness: 'claude', label: 'Unshared', branchName: 'private' });
  effects.denied.clear();
  await expect(client.sessions.autoMergePost.mutate({ params: { id: privateChat.session.id }, body: { enable: true } })).rejects.toThrow(/shared team chats/i);
  expect(effects.git).toHaveBeenCalledTimes(2);
  effects.denied.add('editAgentFolder');
  await expect(client.workspaces.pullBasePost.mutate({ params: workspace, body: {} })).rejects.toThrow(/cannot perform/);
  expect(effects.pull).toHaveBeenCalledOnce();
});
