import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { listenTeam, preloadTeamRoutes } from '@/test/fixtures/team-home';
import { sessionCredential } from '@/lib/orchestrator/session-credential';
import * as q from '@/lib/db/queries';

let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>, server: Awaited<ReturnType<typeof listenTeam>>, credential: string;
beforeAll(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1'); await preloadTeamRoutes(); fixture = await createTeamExecutionFixture(); server = await listenTeam();
  const chat = q.createChatSession({ type: 'orchestration', surfaceKind: q.TEAM_CHAT_SURFACE, workspaceId: fixture.workspace.id, harness: 'codex' });
  q.acceptTeamChatSend({ chatId: chat.id, memberId: fixture.member.member.id, requestingApiKeyId: fixture.member.key.id, clientSendId: 'alias-fixture', text: 'Use tools' }); q.claimNextTeamChatTurn(chat.id);
  credential = sessionCredential(chat.id)!;
}, 120_000);
afterAll(async () => { await server?.close(); await fixture?.cleanup(); vi.unstubAllEnvs(); });

async function call(transport: 'mcp' | 'http', args: Record<string, unknown>) {
  const mcp = transport === 'mcp';
  const response = await fetch(server.url + (mcp ? '/api/team/mcp' : '/api/orchestrator/actions/create_task'), {
    method: 'POST', headers: { authorization: 'Bearer ' + credential, 'x-ri-session': credential, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(mcp ? { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_task', arguments: args } } : args),
  });
  const raw = await response.text();
  const envelope = JSON.parse(raw.includes('data:') ? raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('') : raw);
  return mcp ? JSON.parse(envelope.result.content[0].text) : envelope;
}

it.each(['mcp', 'http'] as const)('%s accepts the common aliases and refuses conflicts/scope fields before writes', async transport => {
  const area = q.createArea({ name: transport + ' Area' });
  for (const extra of [{ areaId: area.id }, { area_id: area.id, target_home_id: q.getHome()!.id }, { areaId: area.id, targetHomeId: q.getHome()!.id }]) {
    const result = await call(transport, { title: 'Alias ' + transport, idempotency_key: crypto.randomUUID(), ...extra });
    expect(result.ok, JSON.stringify(result)).toBe(true);
  }
  const count = q.listTasks().length;
  for (const extra of [{ area_id: area.id, areaId: 'another-area' }, { target_home_id: 'another-home' }, { destination_home_id: 'another-home' }, { space_id: 'another-home' }, { bogus: true }]) {
    expect(await call(transport, { title: 'Refused alias', idempotency_key: crypto.randomUUID(), ...extra })).toMatchObject({ ok: false });
    expect(q.listTasks()).toHaveLength(count);
  }
  expect(q.listTasks().filter(task => task.title === 'Alias ' + transport).map(task => task.areaId)).toEqual([area.id, area.id, area.id]);
});
