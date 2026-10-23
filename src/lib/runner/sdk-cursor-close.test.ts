/**
 * Personal Home: real agentex 0.0.47 Cursor session (one process per turn), a stand-in
 * `agent` that starts the turn and is slow to exit on SIGTERM, real Ri dispatch and the real
 * personal Restart / Close chat / New operations. agentex escalates to SIGKILL after its default
 * 5s grace. Ri must wait through that escalation on the first attempt.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
vi.mock('@/lib/harness/runtime', async original => {
  const { fakeHarnessRuntime, fakeHarnessAuth } = await import('@/test/fixtures/harness-runtime');
  return { ...await original<typeof import('@/lib/harness/runtime')>(), getHarnessRuntime: fakeHarnessRuntime, resolveHarnessAuth: fakeHarnessAuth };
});
// Shutdown qualification must never start an account-backed summary call.
vi.mock('@/lib/sessions/derive-label', () => ({ deriveRetrospectiveLabel: vi.fn(async () => {}) }));

let home: TestHome; let chatId: string; let worktree: string; const pidFile = () => path.join(home.root, 'cursor.pid');
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).toString().trim();
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1');
  home = await createTestHome({ prefix: 'ri-probe-cursor-' });
  const identity = await import('@/lib/home/identity'); identity.resetHomeIdentityCache(); identity.ensureHomeIdentity();
  const repo = path.join(home.root, 'repo'); fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main'); git(repo, 'config', 'user.name', 'P'); git(repo, 'config', 'user.email', 'p@example.invalid');
  fs.writeFileSync(path.join(repo, 'README.md'), 'base\n'); git(repo, 'add', '.'); git(repo, 'commit', '-q', '-m', 'base');
  worktree = path.join(home.root, 'wt'); git(repo, 'worktree', 'add', '-q', '-b', 'feature', worktree, 'main');
  const fake = path.join(home.root, 'fake-cursor-agent');
  fs.writeFileSync(fake, `#!${process.execPath}
if (process.argv.includes('models') || process.argv.includes('--list-models')) { console.log(JSON.stringify([{ id: 'fake', name: 'Fixture model' }])); process.exit(0); }
if (!process.argv.includes('-p')) process.exit(0);
require('node:fs').writeFileSync(${JSON.stringify(path.join(home.root, 'cursor.pid'))}, String(process.pid)); require('node:fs').appendFileSync(${JSON.stringify(path.join(home.root, 'turns.log'))}, 'turn\\n');
process.on('SIGTERM', () => {});
process.stdin.resume();
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'cursor-probe', model: 'fake' }) + '\\n');
setInterval(() => {}, 1000);
`, { mode: 0o755 });
  vi.stubEnv('CURSOR_COMMAND', fake);
  const q = await import('@/lib/db/queries');
  const workspaceId = q.createWorkspace({ name: 'Personal', cwd: repo, isGit: true, baseBranch: 'main', filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false }).id;
  const created = q.createExecutionWithChat({ workspaceId, harness: 'cursor', label: 'Cursor work' });
  chatId = created.session.id;
  q.updateExecution(created.execution.id, { worktreePath: worktree, branchName: 'feature', baseSha: git(worktree, 'rev-parse', 'HEAD') });
});
afterEach(async () => {
  try { const pid = Number(fs.readFileSync(pidFile(), 'utf8')); try { process.kill(-pid, 'SIGKILL'); } catch { /* */ } try { process.kill(pid, 'SIGKILL'); } catch { /* */ } } catch { /* none */ }
  await (await import('@/lib/runner/local-runner')).closeAllSessions().catch(() => {});
  (await import('@/lib/executor/adapter'))._resetExecutorState();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup(); vi.unstubAllEnvs();
});

it.each(['Restart', 'Close chat', 'New'] as const)('%s waits through the real SDK escalation and succeeds on the first try', async action => {
  const q = await import('@/lib/db/queries');
  const executor = await import('@/lib/executor/adapter');
  const { hasHarnessSession } = await import('@/lib/runner/live-state');
  const workspaceId = q.getChatSession(chatId)!.workspaceId!;
  if (action === 'Close chat') q.createChatSession({ workspaceId, executionId: q.getChatSession(chatId)!.executionId, type: 'execution', harness: 'cursor' });
  if (action === 'New') {
    q.archiveChatSession(chatId);
    chatId = q.createChatSession({ workspaceId, type: 'orchestration', harness: 'cursor' }).id;
  }
  const event = q.insertChatEvent({ sessionId: chatId, source: 'user', role: 'user', content: 'Work', createdAt: new Date().toISOString() })!;
  void executor.dispatch(chatId, 'Work', { sourceEventId: event.id }).catch(() => {});
  await vi.waitFor(() => expect(fs.existsSync(pidFile())).toBe(true), { timeout: 15_000 });
  const pid = Number(fs.readFileSync(pidFile(), 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 100));
  const context = { headers: new Headers() } as never;
  let result;
  if (action === 'New') {
    const { POST } = await import('@/lib/server/operations/workspaces/[id]/chat/new');
    result = await POST({ params: { id: workspaceId }, body: { providerId: 'cursor' } }, context);
  } else {
    const { POST } = action === 'Restart' ? await import('@/lib/server/operations/sessions/[id]/restart') : await import('@/lib/server/operations/sessions/[id]/close-chat');
    result = await POST({ params: { id: chatId }, body: {} }, context);
  }
  expect(result.status).toBe(200);
  expect(alive(pid)).toBe(false);
  expect(hasHarnessSession(chatId)).toBe(false);
  expect(q.getChatSession(chatId)?.status).toBe(action === 'Restart' ? 'active' : 'archived');
}, 45_000);
