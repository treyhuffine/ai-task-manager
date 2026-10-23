import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
beforeAll(preloadTeamRoutes);
beforeEach(async () => { fixture = await createTeamExecutionFixture(); vi.stubGlobal('fetch', serveTeam); });
afterEach(async () => { await fixture.cleanup(); vi.unstubAllGlobals(); });
it('keeps agent configuration owner-controlled while members read it and shared content stays usable with AI off', async () => {
  const member = await teamTrpc(fixture.member.token.plaintext), owner = await teamTrpc(fixture.owner.token.plaintext);
  const params = { id: fixture.workspace.id };
  await expect(member.workspaces.update.mutate({ params, body: { instructions: 'Changed' } })).rejects.toMatchObject({ data: { httpStatus: 403 } });
  const cwd = path.join(fixture.home.root, 'another'); fs.mkdirSync(cwd);
  expect(await owner.workspaces.update.mutate({ params, body: { name: 'Updated', cwd, instructions: 'Shared instructions' } })).toMatchObject({ name: 'Updated', cwd });
  expect(q.getWorkspaceSetup(params.id, q.getHome()!.hostDeviceId)?.sourcePath).toBe(cwd);
  q.saveTeamAiSettings({ enabled: false }, fixture.owner.member.id);
  expect(await member.workspaces.get.query({ params })).toMatchObject({ id: params.id, name: 'Updated' });
  q.removeMember(fixture.member.member.id); await expect(member.workspaces.get.query({ params })).rejects.toThrow(/401/);
});
it('cancels accepted work on an agent configuration change with attributed history retained', async () => {
  const owner = await teamTrpc(fixture.owner.token.plaintext);
  const chat = q.createChatSession({ harness: 'codex', type: 'orchestration', workspaceId: fixture.workspace.id, surfaceKind: q.TEAM_CHAT_SURFACE });
  const receipt = q.acceptTeamChatSend({ chatId: chat.id, memberId: fixture.member.member.id, requestingApiKeyId: fixture.member.key.id, clientSendId: 'configuration-queued', text: 'Waiting work' });
  await owner.workspaces.update.mutate({ params: { id: fixture.workspace.id }, body: { instructions: 'Changed instructions' } });
  expect(q.getTeamChatTurn(receipt.turn.id)?.status).toBe('cancelled');
  expect(q.getChatEventById(receipt.message.id)?.authorMemberId).toBe(fixture.member.member.id);
});
