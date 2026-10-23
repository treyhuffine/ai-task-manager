import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
import { agentFolderAnswer } from './agent-folder-operations';
let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
beforeAll(preloadTeamRoutes);
beforeEach(async () => { fixture = await createTeamExecutionFixture(); vi.stubGlobal('fetch', serveTeam); });
afterEach(async () => { await fixture.cleanup(); vi.unstubAllGlobals(); });
it('lets members edit AGENTS.md in the ordinary shared agent folder without a chat and records the member', async () => {
  q.saveTeamAiSettings({ enabled: false }, fixture.owner.member.id);
  const member = await teamTrpc(fixture.member.token.plaintext);
  expect(await member.workspaces.filePut.mutate({ params: { id: fixture.workspace.id }, query: { path: 'AGENTS.md' }, body: { content: 'Shared instructions' } })).toMatchObject({ ok: true });
  expect(fs.readFileSync(path.join(fixture.workspace.cwd, 'AGENTS.md'), 'utf8')).toBe('Shared instructions');
  expect(q.listTeamActivity(fixture.workspace.id)).toMatchObject([{ kind: 'file_change', memberId: fixture.member.member.id, apiKeyId: fixture.member.key.id, resource: 'AGENTS.md', operation: 'write' }]);
  expect(await member.team.agentActivity.query({ workspaceId: fixture.workspace.id })).toMatchObject([{ memberId: fixture.member.member.id, memberName: 'Maya', resource: 'AGENTS.md' }]);
  expect(await member.workspaces.fileGet.query({ params: { id: fixture.workspace.id }, query: { path: 'AGENTS.md' } })).toMatchObject({ content: 'Shared instructions' });
});
it('enforces folder paths, missing authority and revoked membership before filesystem access', async () => {
  const member = await teamTrpc(fixture.member.token.plaintext);
  await expect(member.workspaces.fileGet.query({ params: { id: fixture.workspace.id }, query: { path: '../../outside' } })).rejects.toThrow();
  expect((await agentFolderAnswer(fixture.workspace.id, { kind: 'tree' })).status).toBe(403);
  q.removeMember(fixture.member.member.id);
  await expect(member.workspaces.treeGet.query({ params: { id: fixture.workspace.id } })).rejects.toThrow(/401/);
  expect(q.listTeamActivity(fixture.workspace.id)).toEqual([]);
});
