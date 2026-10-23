/** Probe (review7): Team MCP native start_execution with undeclared keys. At 68c52639 the native tool used a strict MCP schema. */
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { listenTeam, preloadTeamRoutes } from '@/test/fixtures/team-home';
import { sessionCredential } from '@/lib/orchestrator/session-credential';
import * as q from '@/lib/db/queries';
import * as chat from '@/lib/team/ai/chat';
import { closeAllSessions } from '@/lib/runner/local-runner';
vi.mock('@/lib/harness/runtime', async original => {
  const { fakeHarnessRuntime, fakeHarnessAuth } = await import('@/test/fixtures/harness-runtime');
  return { ...await original<typeof import('@/lib/harness/runtime')>(), getHarnessRuntime: fakeHarnessRuntime, resolveHarnessAuth: fakeHarnessAuth };
});
let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>, server: Awaited<ReturnType<typeof listenTeam>>, credential: string, fake: FakeHarness, codex: FakeHarness;
beforeAll(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1'); await preloadTeamRoutes(); fixture = await createTeamExecutionFixture(); server = await listenTeam();
  fake = installFakeHarness('claude'); codex = installFakeHarness('codex'); codex.onTurn(async turn => { await turn.say('ok'); }); q.saveTeamAiSettings({ harness: 'claude', model: fake.modelId }, fixture.owner.member.id);
  fake.onTurn(async turn => { await turn.say('ok'); });
  const parent = q.createChatSession({ type: 'orchestration', surfaceKind: q.TEAM_CHAT_SURFACE, workspaceId: fixture.workspace.id, harness: 'claude', permissionMode: 'auto_edits', createdByMemberId: fixture.member.member.id });
  q.acceptTeamChatSend({ chatId: parent.id, memberId: fixture.member.member.id, requestingApiKeyId: fixture.member.key.id, clientSendId: 'native-fixture', text: 'Use tools' }); q.claimNextTeamChatTurn(parent.id);
  credential = sessionCredential(parent.id)!;
}, 120_000);
afterAll(async () => { await chat.stopTeamAiWork({}, 'end'); await chat.settledTeamAi(); await closeAllSessions(); fake.restore(); codex.restore(); await server?.close(); await fixture?.cleanup(); vi.unstubAllEnvs(); });

async function mcp(name: string, args: Record<string, unknown>) {
  const response = await fetch(server.url + '/api/team/mcp', {
    method: 'POST', headers: { authorization: 'Bearer ' + credential, 'x-ri-session': credential, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const raw = await response.text();
  const envelope = JSON.parse(raw.includes('data:') ? raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('') : raw);
  return envelope.result?.content?.[0]?.text ? { isError: envelope.result.isError, body: JSON.parse(envelope.result.content[0].text) } : envelope;
}

it('refuses unknown and conflicting native keys before child creation', async () => {
  const before = q.listChatSessions().length;
  for (const extra of [{ bogus: true }, { permissionMode: 'ask', permission_mode: 'plan' }, { provider: 'claude', harness: 'codex' }]) {
    const result = await mcp('start_execution', { workspaceId: fixture.workspace.id, prompt: 'Work', requestId: crypto.randomUUID(), ...extra });
    expect(result.body).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
    expect(q.listChatSessions()).toHaveLength(before);
  }
  expect((await mcp('list_workspaces', { bogus: true })).body).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
});

it.each(['mcp', 'http'] as const)('%s honors narrower modes, harness and task aliases', async transport => {
  const task = q.createTask({ title: 'Alias task' });
  const input = { workspace_id: fixture.workspace.id, request_id: crypto.randomUUID(), prompt: 'Plan only', harness: 'codex', permission_mode: 'plan', task_id: task.id };
  const result = transport === 'mcp' ? (await mcp('start_execution', input)).body : await (await fetch(server.url + '/api/orchestrator/actions/start_execution', {
    method: 'POST', headers: { authorization: 'Bearer ' + credential, 'x-ri-session': credential, 'content-type': 'application/json' }, body: JSON.stringify(input),
  })).json();
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  await chat.settledTeamAi();
  const child = q.getChatSession(result.result.sessionId)!;
  expect(child).toMatchObject({ harness: 'codex', permissionMode: 'plan' });
  expect(q.getExecutionTasks(child.executionId!).map(row => row.id)).toContain(task.id);
});

it('retains the strict published list_members schema', async () => {
  const response = await fetch(server.url + '/api/team/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + credential, 'x-ri-session': credential, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  const raw = await response.text();
  const envelope = JSON.parse(raw.includes('data:') ? raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('') : raw);
  expect(envelope.result.tools.find((tool: {name: string}) => tool.name === 'list_members').inputSchema).toMatchObject({ type: 'object', properties: {}, additionalProperties: false });
});
