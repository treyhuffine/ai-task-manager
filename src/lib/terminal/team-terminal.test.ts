import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
const pty = vi.hoisted(() => ({ create: vi.fn(), list: vi.fn(() => []), kill: vi.fn(() => true), write: vi.fn(() => true) }));
vi.mock('./pty-manager', async original => ({ ...await original<typeof import('./pty-manager')>(), createTerminal: pty.create, listTerminals: pty.list, killTerminal: pty.kill, writeInput: pty.write }));
let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
beforeAll(preloadTeamRoutes);
beforeEach(async () => {
  fixture = await createTeamExecutionFixture(); vi.stubGlobal('fetch', serveTeam); vi.clearAllMocks();
  pty.create.mockImplementation(input => ({ ...input, id: 'shared-terminal', shell: '/bin/sh', createdAt: new Date().toISOString(), exited: false, exitCode: null }));
});
afterEach(async () => { await fixture.cleanup(); vi.unstubAllGlobals(); });
it('opens an ordinary attributed agent terminal without a chat and with AI off', async () => {
  q.saveTeamAiSettings({ enabled: false }, fixture.owner.member.id);
  const member = await teamTrpc(fixture.member.token.plaintext);
  const result = await member.workspaces.terminalsPost.mutate({ params: { id: fixture.workspace.id }, body: { cols: 80, rows: 24 } });
  expect(result).toMatchObject({ isHome: true, cwd: fixture.workspace.cwd, createdBy: { id: fixture.member.member.id, name: 'Maya' } });
  expect(q.listTeamActivity(fixture.workspace.id)).toMatchObject([{ kind: 'terminal_open', memberId: fixture.member.member.id, apiKeyId: fixture.member.key.id, resource: result.id }]);
  expect(pty.create).toHaveBeenCalledOnce();
});
it('refuses the generic Home terminal and removed members before creating a PTY', async () => {
  const member = await teamTrpc(fixture.member.token.plaintext);
  await expect(member.home.terminalsPost.mutate({ body: {} })).rejects.toThrow();
  q.removeMember(fixture.member.member.id);
  await expect(member.workspaces.terminalsPost.mutate({ params: { id: fixture.workspace.id }, body: {} })).rejects.toThrow(/401/);
  expect(pty.create).not.toHaveBeenCalled();
});

it('attributes another member taking control and closing a shared terminal without storing commands', async () => {
  const owner = await teamTrpc(fixture.owner.token.plaintext);
  const member = await teamTrpc(fixture.member.token.plaintext);
  const opened = await owner.workspaces.terminalsPost.mutate({ params: { id: fixture.workspace.id }, body: {} });
  const params = { id: fixture.workspace.id, terminalId: opened.id };
  await member.workspaces.terminalsInputTerminalIdPost.mutate({ params, body: { data: 'private command' } });
  await member.workspaces.terminalsInputTerminalIdPost.mutate({ params, body: { data: '\n' } });
  await member.workspaces.terminalsTerminalIdDelete.mutate({ params });
  const activity = q.listTeamActivity(fixture.workspace.id).filter(row => row.kind === 'terminal_control');
  expect(activity).toHaveLength(2);
  expect(activity).toEqual(expect.arrayContaining([
    expect.objectContaining({ memberId: fixture.member.member.id, operation: 'input' }),
    expect.objectContaining({ memberId: fixture.member.member.id, operation: 'close' }),
  ]));
  expect(JSON.stringify(activity)).not.toContain('private command');
});
