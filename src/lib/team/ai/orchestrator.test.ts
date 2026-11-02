import path from 'node:path';
import fs from 'node:fs';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamTestHome, preloadTeamRoutes, serveTeam, teamTrpc, type TeamTestHome } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';

let fixture: TeamTestHome;
beforeAll(preloadTeamRoutes, 120_000);
beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1');
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => serveTeam(input, init));
  fixture = await createTeamTestHome('ri-team-orchestrator-');
});
afterEach(async () => { await fixture.cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('does not create an agent or chat for AI-off content-only Teams', async () => {
  const member = await fixture.joinAs('Maya');
  const client = await teamTrpc(member.token);
  expect(await client.team.ai.orchestrator.query()).toEqual({ workspaceId: null, enabled: false });
  expect(q.listWorkspaces()).toEqual([]);
  expect(q.listTeamChats({ includeArchived: true })).toEqual([]);
  expect(fs.existsSync(path.join(fixture.home.workDir, 'team-assistant'))).toBe(false);
  expect(await client.tasks.create.mutate({ title: 'Content without AI', rawInput: 'Content without AI' })).toMatchObject({ title: 'Content without AI' });
});

it('provisions one ordinary shared assistant, preserving per-member selection and old history', async () => {
  const member = await fixture.joinAs('Maya');
  const owner = await teamTrpc(fixture.owner.token), client = await teamTrpc(member.token);
  const legacy = q.createChatSession({ type: 'orchestration', surfaceKind: q.TEAM_CHAT_SURFACE, harness: 'claude' });
  q.insertChatEvent({ sessionId: legacy.id, role: 'assistant', source: 'agent', content: 'Preserved legacy answer' });
  q.saveTeamAiSettings({ enabled: true, mainChatSessionId: legacy.id, harness: 'codex', model: null }, fixture.owner.id);
  const results = await Promise.all([owner.team.ai.orchestrator.query(), client.team.ai.orchestrator.query(), client.team.ai.orchestrator.query()]);
  expect(new Set(results.map(result => result.workspaceId)).size).toBe(1);
  const id = results[0].workspaceId!;
  expect(q.listWorkspaces()).toHaveLength(1);
  expect(q.getWorkspace(id)).toMatchObject({ isGit: false, cwd: path.join(fixture.home.workDir, 'team-assistant'), defaultDeviceId: q.getHome()!.hostDeviceId });
  expect(q.getWorkspaceSetup(id, q.getHome()!.hostDeviceId)).toMatchObject({ sourcePath: path.join(fixture.home.workDir, 'team-assistant') });
  expect(fs.statSync(q.getWorkspace(id)!.cwd).isDirectory()).toBe(true);
  expect(q.getTeamChat(legacy.id)).toBeTruthy();
  expect(q.getLastChatEventBySource(legacy.id, 'agent')?.content).toBe('Preserved legacy answer');
  expect(q.getMemberPreferences(member.id)?.currentMainChats[id]).toBeUndefined();
  expect(q.getMemberPreferences(fixture.owner.id)?.currentMainChats[id]).toBeUndefined();
  expect(await client.workspaces.chatGet.query({ params: { id } })).toEqual({ session: null });
  expect((await client.workspaces.chatHistoryGet.query({ params: { id } })).sessions).toHaveLength(1);
  const chats = q.listTeamChats({ includeArchived: true });
  expect(chats).toHaveLength(2);
  q.saveTeamAiSettings({ enabled: false }, fixture.owner.id);
  expect(await client.team.ai.orchestrator.query()).toEqual({ workspaceId: id, enabled: false });
  expect((await client.workspaces.chatHistoryGet.query({ params: { id } })).sessions).toHaveLength(1);
  expect(q.listTeamChats({ includeArchived: true })).toHaveLength(2);
});

it('does not repurpose an existing bound assistant or replace its configured folder', async () => {
  const cwd = path.join(fixture.home.root, 'configured'); fs.mkdirSync(cwd);
  const workspace = q.createWorkspace({ name: 'Our assistant', cwd, isGit: false, instructions: 'Keep these instructions' });
  const chat = q.createChatSession({ type: 'orchestration', workspaceId: workspace.id, harness: 'claude', surfaceKind: q.TEAM_CHAT_SURFACE });
  q.saveTeamAiSettings({ mainChatSessionId: chat.id, enabled: true }, fixture.owner.id);
  const client = await teamTrpc(fixture.owner.token);
  expect(await client.team.ai.orchestrator.query()).toMatchObject({ workspaceId: workspace.id });
  expect(q.getWorkspace(workspace.id)?.instructions).toBe('Keep these instructions');
  expect(q.getTeamAiSettings()?.mainChatSessionId).toBe(chat.id);
  expect(q.listWorkspaces()).toHaveLength(1);
  expect(q.listTeamChats()).toHaveLength(1);
});

it('refuses revoked and host-only credentials without provisioning anything', async () => {
  const member = await fixture.joinAs('Maya');
  q.saveTeamAiSettings({ enabled: true }, fixture.owner.id);
  q.removeMember(member.id);
  await expect((await teamTrpc(member.token)).team.ai.orchestrator.query()).rejects.toThrow();
  await expect((await teamTrpc(fixture.hostToken)).team.ai.orchestrator.query()).rejects.toThrow();
  expect(q.listWorkspaces()).toHaveLength(0);
});
