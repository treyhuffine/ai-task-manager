import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import { getRawDb } from '@/lib/db';
import { sessionCredential } from './session-credential';
import { setWorkResultCapabilities } from '@/lib/work-results/capabilities';

vi.mock('@/lib/harness/runtime', async original => {
  const { fakeHarnessRuntime, fakeHarnessAuth } = await import('@/test/fixtures/harness-runtime');
  return { ...await original<typeof import('@/lib/harness/runtime')>(), getHarnessRuntime: fakeHarnessRuntime, resolveHarnessAuth: fakeHarnessAuth };
});
let home: TestHome, chatId: string;
beforeAll(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1');
  home = await createTestHome({ prefix: 'ri-mcp-destination-' });
  (await import('@/lib/home/identity')).ensureHomeIdentity();
  setWorkResultCapabilities({ handoffsEnabled: true });
  chatId = q.createChatSession({ type: 'orchestration', harness: 'claude', label: 'Private conversation' }).id;
  q.insertChatEvent({ sessionId: chatId, source: 'user', role: 'user', content: 'Private MCP canary' });
}, 120_000);
afterAll(async () => { await home.cleanup(); vi.unstubAllEnvs(); });

const cases = [
  ['main', () => import('@/app/api/orchestrator/[transport]/route'), 'create_task', { title: 'Foreign task', idempotency_key: 'foreign-task-request' }],
  ['coordination', () => import('@/app/api/orchestrator/coordination/[transport]/route'), 'get_session_messages', {}],
  ['results', () => import('@/app/api/orchestrator/results/[transport]/route'), 'list_results', {}],
  ['email', () => import('@/app/api/orchestrator/email/[transport]/route'), 'create_email_draft', { request_id: 'foreign-email-request', subject: 'Private subject' }],
  ['browser', () => import('@/app/api/orchestrator/browser/[transport]/route'), 'browser_read', {}],
] as const;
it.each(cases)('%s tools/call refuses foreign targets before any personal change', async (name, load, tool, args) => {
  const route = await load();
  const input = name === 'coordination' ? { sessionId: chatId } : args;
  for (const field of ['target_home_id', 'targetHomeId', 'target_home', 'target-home-id', 'home_id', 'teamId', 'target_team', 'teamID', 'home-id', 'destination_home_id', 'destinationHomeId', 'dest_home_id', 'to_home_id', 'home_ids', 'homeIds', 'team_home_id', 'teamHomeId', 'space_id', 'spaceId', 'target_space_id', 'targetSpaceId', 'connected_home_id', 'home_uuid', ' target_home_id', 'target home id']) {
    const before = getRawDb().prepare('SELECT total_changes() AS n').get();
    const response = await route.POST(new Request(`http://home.test/api/orchestrator/${name === 'main' ? '' : name + '/'}mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-ri-session': sessionCredential(chatId)! },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: { ...input, [field]: 'foreign-home' } } }),
    }));
    const raw = await response.text();
    const json = raw.includes('data:') ? raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('') : raw;
    const reply = JSON.parse(json);
    expect(reply.result?.isError, raw).toBe(true);
    const envelope = JSON.parse(reply.result.content[0].text);
    expect(envelope).toMatchObject({ ok: false, error: { code: expect.stringMatching(/unsupported|invalid_params|not_found/) } });
    expect(envelope.error.message).toMatch(/No personal write|No write was attempted|team is unknown, disconnected/);
    expect(getRawDb().prepare('SELECT total_changes() AS n').get()).toEqual(before);
  }
});

it('accepts the session_id alias over MCP and has a working personal-read positive control', async () => {
  const route = await import('@/app/api/orchestrator/coordination/[transport]/route');
  for (const field of ['sessionId', 'session_id']) {
    const response = await route.POST(new Request('http://home.test/api/orchestrator/coordination/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-ri-session': sessionCredential(chatId)! },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_session_messages', arguments: { [field]: chatId } } }),
    }));
    const raw = await response.text();
    const json = raw.includes('data:') ? raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('') : raw;
    const envelope = JSON.parse(JSON.parse(json).result.content[0].text);
    expect(envelope.ok).toBe(true);
    expect(JSON.stringify(envelope.result)).toContain('Private MCP canary');
  }
});

it('advertises strict result schemas and refuses ordinary extra fields', async () => {
  const route = await import('@/app/api/orchestrator/results/[transport]/route');
  const call = async (method: string, params?: unknown) => {
    const response = await route.POST(new Request('http://home.test/api/orchestrator/results/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-ri-session': sessionCredential(chatId)! },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }),
    }));
    const raw = await response.text();
    return JSON.parse(raw.includes('data:') ? raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('') : raw);
  };
  const listed = await call('tools/list');
  expect(listed.result.tools.find((tool: { name: string }) => tool.name === 'list_results').inputSchema.additionalProperties).toBe(false);
  const handoff = listed.result.tools.find((tool: { name: string }) => tool.name === 'get_handoff_context');
  expect(handoff.inputSchema.properties).toEqual({});
  expect(handoff.inputSchema.additionalProperties).toBeUndefined();
  const handoffRefusal = await call('tools/call', { name: 'get_handoff_context', arguments: { extra_field: true } });
  expect(JSON.parse(handoffRefusal.result.content[0].text)).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
  const rejected = await call('tools/call', { name: 'list_results', arguments: { extra_field: true } });
  expect(rejected.result.isError).toBe(true);
  expect(JSON.parse(rejected.result.content[0].text)).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
});
