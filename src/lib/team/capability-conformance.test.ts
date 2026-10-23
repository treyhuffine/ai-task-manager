import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import { API_PROTOCOL, API_PROTOCOL_HEADER } from '@/lib/releases/api-contract';
import * as q from '@/lib/db/queries';
import type { TeamAction } from './capabilities';
import fs from 'node:fs';
import path from 'node:path';
const policy = vi.hoisted(() => ({ denied: new Set<string>() }));
vi.mock('./capabilities', async original => {
  const actual = await original<typeof import('./capabilities')>();
  return { ...actual, hasTeamCapability: (...args: Parameters<typeof actual.hasTeamCapability>) => !policy.denied.has(args[1]) && actual.hasTeamCapability(...args) };
});
let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
beforeAll(preloadTeamRoutes, 120_000);
beforeEach(async () => { policy.denied.clear(); fixture = await createTeamExecutionFixture(); vi.stubGlobal('fetch', serveTeam); });
afterEach(async () => { policy.denied.clear(); vi.unstubAllGlobals(); await fixture.cleanup(); });
const deny = (action: TeamAction) => policy.denied.add(action);

it('admits stop independently from content edits on both tRPC and REST', async () => {
  const client = await teamTrpc(fixture.member.token.plaintext);
  const chat = q.createChatSession({ workspaceId: fixture.workspace.id, harness: 'claude', type: 'orchestration', surfaceKind: q.TEAM_CHAT_SURFACE });
  deny('editContent');
  await expect(client.tasks.create.mutate({ title: 'Refused', rawInput: 'Refused' })).rejects.toThrow(/cannot perform/);
  expect(await client.sessions.interruptPost.mutate({ params: { id: chat.id }, body: {} })).toEqual({ ok: true });
  const response = await serveTeam(`http://team.test/api/sessions/${chat.id}/interrupt`, { method: 'POST', headers: { authorization: `Bearer ${fixture.member.token.plaintext}`, 'content-type': 'application/json', [API_PROTOCOL_HEADER]: String(API_PROTOCOL) }, body: '{}' });
  expect(response.status).toBe(200);
  deny('stopTurn');
  await expect(client.sessions.interruptPost.mutate({ params: { id: chat.id }, body: {} })).rejects.toThrow(/cannot perform/);
});

it('refuses the compatibility send before recording work when run permission is removed', async () => {
  const client = await teamTrpc(fixture.member.token.plaintext);
  const chat = q.createChatSession({ workspaceId: fixture.workspace.id, harness: 'claude', type: 'orchestration', surfaceKind: q.TEAM_CHAT_SURFACE });
  deny('runTeamAgent');
  await expect(client.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'denied-native-send', text: 'Do not accept' })).rejects.toThrow(/cannot perform/);
  expect(q.listTeamChatTurns(chat.id)).toEqual([]);
});

it('shares entity titles and task attention with a member', async () => {
  const client = await teamTrpc(fixture.member.token.plaintext);
  const task = q.createTask({ title: 'Linked shared work' });
  expect(await client.entities.titlesGet.query({ query: { refs: `task:${task.id}` } })).toMatchObject({ titles: [{ id: task.id, title: 'Linked shared work' }] });
  expect(await client.tasks.attention.query({ ids: [task.id] })).toHaveProperty(task.id);
});

it('supports attributed file tree mutations for a member and refuses them when folder editing is denied', async () => {
  const client = await teamTrpc(fixture.member.token.plaintext);
  const params = { id: fixture.workspace.id };
  await client.workspaces.fileCreatePost.mutate({ params, body: { path: 'draft.txt' } });
  await client.workspaces.fileRenamePost.mutate({ params, body: { from: 'draft.txt', to: 'renamed.txt' } });
  await client.workspaces.dirPost.mutate({ params, body: { path: 'drafts' } });
  await client.workspaces.dirDelete.mutate({ params, query: { path: 'drafts' }, body: {} });
  expect(fs.existsSync(path.join(fixture.workspace.cwd, 'renamed.txt'))).toBe(true);
  const chat = q.createChatSession({ workspaceId: fixture.workspace.id, type: 'orchestration', harness: 'claude', surfaceKind: q.TEAM_CHAT_SURFACE });
  await client.sessions.fileCreatePost.mutate({ params: { id: chat.id }, body: { path: 'from-chat.txt' } });
  expect(fs.existsSync(path.join(fixture.workspace.cwd, 'from-chat.txt'))).toBe(true);
  deny('editAgentFolder');
  await expect(client.workspaces.fileCreatePost.mutate({ params, body: { path: 'refused.txt' } })).rejects.toThrow(/cannot perform/);
  await expect(client.sessions.fileCreatePost.mutate({ params: { id: chat.id }, body: { path: 'refused-chat.txt' } })).rejects.toThrow(/cannot perform/);
  await expect(client.workspaces.fileRenamePost.mutate({ params, body: { from: 'renamed.txt', to: 'moved.txt' } })).rejects.toThrow(/cannot perform/);
  await expect(client.workspaces.fileDelete.mutate({ params, query: { path: 'renamed.txt' }, body: {} })).rejects.toThrow(/cannot perform/);
  await expect(client.workspaces.dirPost.mutate({ params, body: { path: 'forbidden-dir' } })).rejects.toThrow(/cannot perform/);
  await expect(client.workspaces.dirDelete.mutate({ params, query: { path: 'drafts' }, body: {} })).rejects.toThrow(/cannot perform/);
  await expect(client.workspaces.fileResolveConflictPost.mutate({ params, body: { path: 'renamed.txt', content: 'overwrite' } })).rejects.toThrow(/cannot perform/);
  await expect(client.sessions.fileRenamePost.mutate({ params: { id: chat.id }, body: { from: 'from-chat.txt', to: 'moved-chat.txt' } })).rejects.toThrow(/cannot perform/);
  await expect(client.sessions.fileDelete.mutate({ params: { id: chat.id }, query: { path: 'from-chat.txt' }, body: {} })).rejects.toThrow(/cannot perform/);
  await expect(client.sessions.fileResolveConflictPost.mutate({ params: { id: chat.id }, body: { path: 'from-chat.txt', content: 'overwrite' } })).rejects.toThrow(/cannot perform/);
  expect(fs.existsSync(path.join(fixture.workspace.cwd, 'renamed.txt'))).toBe(true);
  expect(fs.existsSync(path.join(fixture.workspace.cwd, 'from-chat.txt'))).toBe(true);
  expect(fs.existsSync(path.join(fixture.workspace.cwd, 'refused.txt'))).toBe(false);
});

it('checks edit authority for reverts and preview mutations while preserving reads', async () => {
  const client = await teamTrpc(fixture.member.token.plaintext);
  const task = q.createTask({ title: 'Before' });
  q.updateTask(task.id, { title: 'After' }, { source: 'human' });
  const version = q.listEntityVersions('task', task.id)[0];
  deny('editContent');
  await expect(client.entityVersions.revertPost.mutate({ params: { id: version.id }, body: {} })).rejects.toThrow(/cannot.*edit/);
  const created = q.createExecutionWithChat({ label: null, workspaceId: fixture.workspace.id, harness: 'claude', surfaceKind: q.TEAM_CHAT_SURFACE, createdByMemberId: fixture.owner.member.id, worktreePath: fixture.workspace.cwd });
  expect(await client.executions.tasksGet.query({ params: { id: created.execution.id } })).toEqual([]);
  expect(await client.executions.reviewContextGet.query({ params: { id: created.execution.id } })).toBeDefined();
  deny('editAgentFolder');
  for (const mutation of [client.executions.previewStartPost, client.executions.previewStopPost, client.executions.previewPinPost]) {
    await expect(mutation.mutate({ params: { id: created.execution.id }, body: {} })).rejects.toThrow(/cannot perform/);
  }
  await expect(client.workspaces.previewRestoreSetPost.mutate({ params: { id: fixture.workspace.id }, body: {} })).rejects.toThrow(/cannot perform/);
  const personal = q.createExecutionWithChat({ label: null, workspaceId: fixture.workspace.id, harness: 'claude' });
  await expect(client.executions.tasksGet.query({ params: { id: personal.execution.id } })).rejects.toThrow(/shared Team executions/);
});

it('defaults member voice to Browser and refuses host speech preferences', async () => {
  const client = await teamTrpc(fixture.member.token.plaintext);
  expect(await client.userState.list.query({})).toMatchObject({ voiceModel: 'web/speech-recognition' });
  await expect(client.userState.update.mutate({ body: { voiceModel: 'local/parakeet-tdt-0.6b-v3' } })).rejects.toThrow(/browser speech/);
  expect(await client.userState.update.mutate({ body: { voiceModel: 'web/speech-recognition', voiceAutoSend: false } })).toMatchObject({ voiceModel: 'web/speech-recognition', voiceAutoSend: false });
});
