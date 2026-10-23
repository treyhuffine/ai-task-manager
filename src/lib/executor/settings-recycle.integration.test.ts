/** Real persistence operations and runner shutdown state on disposable Homes. */
import fs from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import type { AgentSession } from '@agentex/agent';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { ensureHomeIdentity, resetHomeIdentityCache } from '@/lib/home/identity';
import * as q from '@/lib/db/queries';
import * as executor from './adapter';
import { sessionChannel, subscribe, type SessionStreamMessage } from '@/lib/realtime/bus';
import { send } from '@/lib/runner/local-runner';
import { PATCH } from '@/lib/server/operations/workspaces/[id]';
import { PUT } from '@/lib/server/operations/workspaces/[id]/integration-scopes';
import { operationContext } from '@/lib/server/operation';
import { declineCard } from '@/lib/integrations/connection-requests';
import type { ConnectionRequestView } from '@/lib/integrations/connection-catalog';
import * as health from './health';
let home: TestHome;
beforeEach(async () => { vi.stubEnv('RI_MIRROR_DISABLED', '1'); home = await createTestHome(); resetHomeIdentityCache(); ensureHomeIdentity(); executor._resetExecutorState(); });
afterEach(async () => { vi.restoreAllMocks(); executor._resetExecutorState(); resetHomeIdentityCache(); await home.cleanup(); vi.unstubAllEnvs(); });
function connectionCard(sessionId: string) {
  const view: ConnectionRequestView = { kind: 'connect', providerId: 'google', providerName: 'Google', label: 'Gmail', toolkitIds: ['gmail'],
    method: 'oauth2', credentialFields: [], reason: 'Read a message', requestedBy: 'agent', agent: null, onBehalf: false,
    connectionId: null, account: null, scopes: null, authConfigId: null };
  return q.insertChatEvent({ sessionId, role: 'system', source: 'connection_request', content: 'Connect Gmail', toolInput: view })!;
}
it('agent settings and connector scopes save repeatedly after failed idle close, while sends require confirmed Restart', async () => {
  const cwd = path.join(home.root, 'project'); fs.mkdirSync(cwd);
  const workspace = q.createWorkspace({ name: 'Personal agent', cwd, isGit: false });
  const chat = q.createChatSession({ harness: 'codex', model: 'gpt-6.1-sol', workspaceId: workspace.id, type: 'orchestration' });
  const close = vi.fn(async () => { throw new Error('Shutdown failed'); });
  const sendMessage = vi.fn(); executor._cacheHarnessSession(chat.id, { close, send: sendMessage } as unknown as AgentSession);
  const frames: SessionStreamMessage[] = [];
  const unsubscribe = subscribe(sessionChannel(chat.id), frame => frames.push(frame));
  const request = operationContext(new Request('http://fixture/'), {}, '/fixture');
  for (const instructions of ['First saved instruction.', 'Second saved instruction.']) {
    const result = await PATCH({ params: { id: workspace.id }, body: { instructions } }, request);
    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(q.getWorkspace(workspace.id)?.instructions).toBe(instructions);
  }
  expect(await PUT({ params: { id: workspace.id }, body: { scopes: [] } }, request)).toMatchObject({ ok: true, status: 200 });
  expect(q.getWorkspace(workspace.id)?.integrationScopes).toEqual([]);
  unsubscribe(); expect(frames).toContainEqual({ kind: 'runtime', running: false });
  expect(close).toHaveBeenCalledOnce(); expect(executor.hasUnconfirmedClose(chat.id)).toBe(true); expect(executor.hasHarnessSession(chat.id)).toBe(true);
  await expect(send({ chatSessionId: chat.id, message: 'Must not use stale config', turnId: 'turn', runId: null, spec: null })).rejects.toMatchObject({ code: 'already_running' });
  expect(sendMessage).not.toHaveBeenCalled();
  close.mockResolvedValueOnce(undefined as never);
  expect(await executor.close(chat.id)).toMatchObject({ closed: true });
  expect(executor.hasUnconfirmedClose(chat.id)).toBe(false); expect(executor.hasHarnessSession(chat.id)).toBe(false);
  expect(await send({ chatSessionId: chat.id, message: 'Fresh config required', turnId: 'next', runId: null, spec: null })).toEqual({ status: 'needs_spec' });
});

it('Archive preserves a real worktree when a legacy process record has ambiguous ancestry', async () => {
  const repo = path.join(home.root, 'repo'), worktree = path.join(home.root, 'worktree'); fs.mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(path.join(repo, 'README.md'), 'base\n'); git('add', '.'); git('commit', '-qm', 'base'); git('worktree', 'add', '-qb', 'work', worktree);
  const workspace = q.createWorkspace({ name: 'Code', cwd: repo, isGit: true, baseBranch: 'main' });
  const { execution, session } = q.createExecutionWithChat({ workspaceId: workspace.id, harness: 'codex', label: 'Tracked work' });
  q.updateExecution(execution.id, { worktreePath: worktree, branchName: 'work', baseSha: git('rev-parse', 'HEAD') });
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  try {
    const { recordHarnessProcess, harnessProcessRecordPath, _resetHarnessProcessState } = await import('@/lib/runner/harness-processes');
    _resetHarnessProcessState(); await recordHarnessProcess(session.id, child.pid!);
    const file = harnessProcessRecordPath(), record = JSON.parse(fs.readFileSync(file, 'utf8'));
    record.entries[0].process.ppid = 999999; delete record.entries[0].process.birthId;
    fs.writeFileSync(file, JSON.stringify(record));
    executor._cacheHarnessSession(session.id, { close: async () => {} } as unknown as AgentSession);
    const { POST } = await import('@/lib/server/operations/sessions/[id]/archive');
    const result = await POST({ params: { id: session.id }, body: {} }, operationContext(new Request('http://fixture/'), {}, '/fixture'));
    expect(result).toMatchObject({ ok: false, status: 412, body: { error: 'unavailable', message: expect.stringMatching(/close|stop|confirm/i) } }); expect(fs.existsSync(worktree)).toBe(true);
    expect(q.getChatSession(session.id)?.status).toBe('active'); expect(JSON.parse(fs.readFileSync(file, 'utf8')).entries).toHaveLength(1);
    expect(() => process.kill(child.pid!, 0)).not.toThrow(); expect(executor.hasUnconfirmedClose(session.id)).toBe(true);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
    await executor.close(session.id);
  }
}, 15_000);

it('keeps the full connection decision visible and durable when an unconfirmed chat cannot receive its notification', async () => {
  const chat = q.createChatSession({ harness: 'codex', type: 'content' });
  const close = vi.fn(async () => { throw new Error('Shutdown failed'); });
  const sendMessage = vi.fn(); executor._cacheHarnessSession(chat.id, { close, send: sendMessage } as unknown as AgentSession);
  const held = executor.beginDispatchPreparation(chat.id);
  expect(await executor.close(chat.id)).toMatchObject({ closed: false });
  const card = connectionCard(chat.id);
  await declineCard(card.id);
  await vi.waitFor(() => expect(q.listChatEvents(chat.id).find(event => event.source === 'error')?.content).toContain('This decision is saved.'));
  const events = q.listChatEvents(chat.id);
  expect(events.find(event => event.source === 'connection_response')?.toolInput).toMatchObject({ outcome: 'declined' });
  expect(events.find(event => event.source === 'error')?.content).toContain('The user chose not to connect Gmail for now');
  expect(sendMessage).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
  await expect(declineCard(card.id)).rejects.toMatchObject({ code: 'already_answered' }); expect(q.listChatEvents(chat.id)).toHaveLength(events.length);
  executor.endDispatchPreparation(chat.id, held);
});
it('preserves the full decision note when delivery is refused after the initial health check', async () => {
  const chat = q.createChatSession({ harness: 'codex', type: 'content' });
  vi.spyOn(health, 'healthCheckSession').mockResolvedValue({ classification: 'healthy', fixes: [], replayed: 0, redispatched: false });
  const dispatch = vi.spyOn(executor, 'dispatch').mockRejectedValue(new Error('Stopped before dispatch'));
  const card = connectionCard(chat.id);
  await declineCard(card.id);
  await vi.waitFor(() => expect(q.listChatEvents(chat.id).find(event => event.source === 'error')?.content).toContain('This decision is saved.'));
  expect(q.listChatEvents(chat.id).filter(event => event.source === 'error')).toHaveLength(1);
  expect(q.listChatEvents(chat.id).find(event => event.source === 'error')?.content).toContain('The user chose not to connect Gmail for now');
  expect(dispatch).toHaveBeenCalledOnce(); expect(executor.isRunning(chat.id)).toBe(false);
});
