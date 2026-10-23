import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { listenTeam, preloadTeamRoutes } from '@/test/fixtures/team-home';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ensureSessionCli } from '@/lib/executor/session-cli';
import { sessionCredential } from '@/lib/orchestrator/session-credential';
import * as q from '@/lib/db/queries';

async function callAgentCli(args: string[], overrides: Partial<NodeJS.ProcessEnv> = {}) {
  const launcher = ensureSessionCli()!.launcher;
  try { const r = await promisify(execFile)(launcher, ['agent', ...args], { env: { ...process.env, NODE_NO_WARNINGS: '1', ...overrides }, timeout: 45_000 }); return { out: r.stdout, err: r.stderr }; }
  catch (error) { const r = error as { stdout: string; stderr: string }; return { out: r.stdout, err: r.stderr }; }
}

let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>, server: Awaited<ReturnType<typeof listenTeam>>;
beforeAll(async () => {
  vi.stubEnv('NODE_ENV', 'development');
  await preloadTeamRoutes(); fixture = await createTeamExecutionFixture(); server = await listenTeam();
  const chat = q.createChatSession({ type: 'orchestration', harness: 'codex', workspaceId: fixture.workspace.id, surfaceKind: q.TEAM_CHAT_SURFACE });
  q.acceptTeamChatSend({ chatId: chat.id, memberId: fixture.member.member.id, requestingApiKeyId: fixture.member.key.id, clientSendId: 'cli-fixture', text: 'Fixture turn' });
  q.claimNextTeamChatTurn(chat.id);
  vi.stubEnv('RI_HOME_TOOLS_URL', server.url); vi.stubEnv('RI_SESSION_CREDENTIAL', sessionCredential(chat.id)!);
}, 120_000);
afterAll(async () => { await server?.close(); await fixture?.cleanup(); vi.unstubAllEnvs(); });

it('uses string receipt flags, applies JSON alias overrides, and reports conflicts without losing authorization', async () => {
  const a = q.createArea({ name: 'Flag Area' }), b = q.createArea({ name: 'JSON Area' });
  const created = await callAgentCli(['create_task', '--title', 'Numeric receipt', '--area-id', a.id, '--idempotency-key', '123456789']);
  expect(created.err).toBe('');
  expect(JSON.parse(created.out)).toMatchObject({ id: expect.any(String), area: { id: a.id } });
  const overridden = await callAgentCli(['create_task', '--title', 'JSON override', '--area-id', a.id, '--idempotency-key', 'cli-json-override', '--input', JSON.stringify({ areaId: b.id })]);
  expect(overridden.err).toBe('');
  expect(JSON.parse(overridden.out)).toMatchObject({ area: { id: b.id } });
  const count = q.listTasks().length;
  const rejected = await callAgentCli(['create_task', '--input', JSON.stringify({ title: 'Conflicting', areaId: a.id, area_id: b.id, idempotency_key: 'cli-json-conflict' })]);
  expect(JSON.parse(rejected.err)).toMatchObject({ ok: false, error: { code: 'invalid_params', message: expect.stringMatching(/Conflicting values/) } });
  expect(q.listTasks()).toHaveLength(count);
}, 60_000);

it('refuses unsigned, forged and expired Team session launchers without local writes', async () => {
  const archived = q.createChatSession({ type: 'orchestration', harness: 'codex', workspaceId: fixture.workspace.id, surfaceKind: q.TEAM_CHAT_SURFACE });
  q.archiveChatSession(archived.id);
  const before = q.listTasks().length;
  for (const credential of ['', 'forged.signature', sessionCredential(archived.id)!]) {
    const result = await callAgentCli(['create_task', '--title', 'Must not be created', '--idempotency-key', crypto.randomUUID()], { RI_SESSION_CREDENTIAL: credential });
    expect(result.out).toBe(''); expect(result.err.length).toBeGreaterThan(0);
    expect(q.listTasks()).toHaveLength(before);
  }
}, 120_000);

it('accepts full JSON inputs for positional actions and retains old positional and override forms', async () => {
  const task = q.createTask({ title: 'CLI full input' });
  const json = await callAgentCli(['get_task', '--input', JSON.stringify({ id: task.id })]);
  expect(json.err).toBe(''); expect(JSON.parse(json.out)).toMatchObject({ id: task.id });
  const positional = await callAgentCli(['get_task', task.id]);
  expect(positional.err).toBe(''); expect(JSON.parse(positional.out)).toMatchObject({ id: task.id });
  const override = await callAgentCli(['get_task', 'missing-positional', '--input', JSON.stringify({ id: task.id })]);
  expect(override.err).toBe(''); expect(JSON.parse(override.out)).toMatchObject({ id: task.id });
  const missing = await callAgentCli(['get_task', '--input', '{}']);
  expect(missing.out).toBe(''); expect(JSON.parse(missing.err)).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
}, 120_000);
