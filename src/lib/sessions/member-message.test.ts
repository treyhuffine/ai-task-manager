import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { closeAllSessions, _resetExecutorState } from '@/lib/runner/local-runner';
import fs from 'node:fs';
import path from 'node:path';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
import { stopTeamAiWork, settledTeamAi } from '@/lib/team/ai/chat';
import { getAttachmentsDir } from '@/lib/config/paths';
import type { Attachment } from '@/db/types';
import { API_PROTOCOL, API_PROTOCOL_HEADER } from '@/lib/releases/api-contract';

let fake: FakeHarness;
let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
let session: ReturnType<typeof q.createExecutionWithChat>['session'];
beforeAll(preloadTeamRoutes);
beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1'); fixture = await createTeamExecutionFixture(); fake = installFakeHarness('codex'); fake.modelId = 'gpt-6.1-sol'; vi.stubGlobal('fetch', serveTeam);
  const created = q.createExecutionWithChat({ workspaceId: fixture.workspace.id, createdByMemberId: fixture.member.member.id, surfaceKind: q.TEAM_CHAT_SURFACE, harness: 'codex', label: 'Shared project', model: 'gpt-6.1-sol' });
  session = created.session;
  fake.onTurn(async () => { await new Promise(() => {}); });
  q.createPlacement({ executionId: created.execution.id, deviceId: q.getHome()!.hostDeviceId, startReason: 'created', worktreePath: fixture.workspace.cwd });
});
afterEach(async () => { await stopTeamAiWork({}, 'Fixture finished.'); await settledTeamAi(); await closeAllSessions(); _resetExecutorState(); fake.restore(); await fixture.cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const params = () => ({ id: session.id });
const member = () => teamTrpc(fixture.member.token.plaintext);
const owner = () => teamTrpc(fixture.owner.token.plaintext);
const headers = () => ({ authorization: 'Bearer ' + fixture.member.token.plaintext, 'content-type': 'application/json', [API_PROTOCOL_HEADER]: String(API_PROTOCOL) });

it('uses common chat reads and writes with stable optimistic ids and live member authors', async () => {
  const client = await member();
  expect(await client.sessions.get.query({ params: params() })).toMatchObject({ id: session.id, createdByMemberId: fixture.member.member.id });
  const id = uuidv7();
  const body = { id, content: 'Review our shared project.' };
  const message = await client.sessions.messagesPost.mutate({ params: params(), body });
  expect(message).toMatchObject({ id, authorMemberId: fixture.member.member.id, content: body.content });
  expect((await client.sessions.messagesPost.mutate({ params: params(), body })).id).toBe(id);
  expect((await client.sessions.eventsGet.query({ params: params() })).filter(event => event.source === 'user')).toEqual([expect.objectContaining({ id, authorMemberId: fixture.member.member.id })]);
  expect(q.listTeamChatTurns(session.id)).toHaveLength(1);
  await expect(client.sessions.messagesPost.mutate({ params: params(), body: { ...body, content: 'Different content' } })).rejects.toMatchObject({ data: { httpStatus: 409 } });
  const raw = await serveTeam(`http://team.test/api/sessions/${session.id}`, { headers: headers() });
  expect(raw.status).toBe(200);
});
it('preserves shared attachment metadata and expands referenced files through the ordinary runner', async () => {
  const client = await member();
  const attachment: Attachment = { fileName: uuidv7() + '.txt', originalName: 'Shared brief.txt', mimeType: 'text/plain', size: 12, uploadedAt: new Date().toISOString() };
  fs.mkdirSync(getAttachmentsDir(), { recursive: true }); fs.writeFileSync(path.join(getAttachmentsDir(), attachment.fileName), 'Shared brief');
  const body = { id: uuidv7(), content: `Read [[file:${attachment.fileName}]].`, attachments: [attachment] };
  const message = await client.sessions.messagesPost.mutate({ params: params(), body });
  expect(message.attachments).toEqual([attachment]);
  await vi.waitFor(() => expect(fake.sessions).toHaveLength(1));
  expect(fake.latest().messages[0]).toContain(path.join(getAttachmentsDir(), attachment.fileName));
  const differentOrder = { uploadedAt: attachment.uploadedAt, size: attachment.size, mimeType: attachment.mimeType, originalName: attachment.originalName, fileName: attachment.fileName };
  expect((await client.sessions.messagesPost.mutate({ params: params(), body: { ...body, attachments: [differentOrder] } })).id).toBe(body.id);
  await expect(client.sessions.messagesPost.mutate({ params: params(), body: { ...body, attachments: [] } })).rejects.toMatchObject({ data: { httpStatus: 409 } });
});
it('refuses personal app context and validates unapproved native settings without changing stored work', async () => {
  const client = await member();
  await expect(client.sessions.messagesPost.mutate({ params: params(), body: { id: uuidv7(), content: 'Private app context', appContext: { viewId: uuidv7(), revision: 1 } } })).rejects.toMatchObject({ data: { httpStatus: 403 } });
  const patch = await serveTeam(`http://team.test/api/sessions/${session.id}`, { method: 'PATCH', headers: { ...headers(), 'x-ri-member-role': 'owner' }, body: JSON.stringify({ model: 'gpt-unapproved', permissionMode: 'auto_all' }) });
  expect(patch.status).toBe(400);
  expect(await patch.json()).toMatchObject({ error: expect.stringContaining('Invalid model') });
  expect(q.getChatSession(session.id)?.model).toBe('gpt-6.1-sol'); expect(q.listTeamChatTurns(session.id)).toHaveLength(0);
});
it('allows any active member to stop a shared turn through the normal chat control', async () => {
  const own = await owner(), other = await member();
  await own.sessions.messagesPost.mutate({ params: params(), body: { id: uuidv7(), content: 'Owner request' } });
  for (let attempt = 0; attempt < 200 && !q.runningTeamChatTurn(session.id); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  expect(await other.sessions.runtimeStatusGet.query({ params: params() })).toMatchObject({ running: true, canStop: true });
  expect(q.runningTeamChatTurn(session.id)?.memberId).toBe(fixture.owner.member.id);
  expect(await other.sessions.interruptPost.mutate({ params: params(), body: {} })).toEqual({ ok: true });
  await settledTeamAi(); expect(q.listTeamChatTurns(session.id)[0].status).toBe('cancelled');
});
it('retains readable history with AI off and refuses sends, then revokes reads after sign-out', async () => {
  const client = await member();
  q.insertChatEvent({ sessionId: session.id, role: 'assistant', source: 'agent', content: 'Saved shared answer' });
  q.saveTeamAiSettings({ enabled: false }, fixture.owner.member.id);
  expect(await client.sessions.get.query({ params: params() })).toMatchObject({ id: session.id });
  expect(await client.sessions.eventsGet.query({ params: params() })).toEqual([expect.objectContaining({ content: 'Saved shared answer' })]);
  await expect(client.sessions.messagesPost.mutate({ params: params(), body: { id: uuidv7(), content: 'Cannot run' } })).rejects.toMatchObject({ data: { httpStatus: 403 } });
  q.revokeApiKey(fixture.member.key.id, 'Signed out');
  const raw = await serveTeam(`http://team.test/api/sessions/${session.id}/events`, { headers: headers() }); expect(raw.status).toBe(401);
});
