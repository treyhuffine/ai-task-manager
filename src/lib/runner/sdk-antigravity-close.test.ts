/**
 * Personal Home: real agentex 0.0.47 Antigravity session, a stand-in `agy` that is slow to exit
 * (ignores stdin EOF and SIGTERM, as a CLI flushing its history would be), real Ri start/dispatch,
 * real Git worktree, real archiveExecutionSession. Confirm process exit before removing the worktree.
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

let home: TestHome; let chatId: string; let worktree: string; let agy: string; const pids: number[] = [];
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).toString().trim();
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1');
  home = await createTestHome({ prefix: 'ri-probe-agy-archive-' });
  const identity = await import('@/lib/home/identity'); identity.resetHomeIdentityCache(); identity.ensureHomeIdentity();
  const repo = path.join(home.root, 'repo'); fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main'); git(repo, 'config', 'user.name', 'P'); git(repo, 'config', 'user.email', 'p@example.invalid');
  fs.writeFileSync(path.join(repo, 'README.md'), 'base\n'); git(repo, 'add', '.'); git(repo, 'commit', '-q', '-m', 'base');
  worktree = path.join(home.root, 'wt'); git(repo, 'worktree', 'add', '-q', '-b', 'feature', worktree, 'main');
  agy = path.join(home.root, 'fake-agy');
  fs.writeFileSync(agy, `#!${process.execPath}
if (!process.argv.includes('--input-format')) process.exit(0);
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(path.join(home.root, 'agy.pid'))}, String(process.pid));
process.on('SIGTERM', () => {}); process.on('SIGINT', () => {});
let buf = '';
process.stdin.on('data', chunk => { buf += chunk; let i; while ((i = buf.indexOf('\\n')) >= 0) { buf = buf.slice(i + 1);
  process.stdout.write(JSON.stringify({ event: 'init', conversation_id: 'conv-probe' }) + '\\n');
  process.stdout.write(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'done', conversation_id: 'conv-probe' } }) + '\\n'); } });
process.stdin.on('end', () => {});
setInterval(() => {}, 1000);
`, { mode: 0o755 });
  vi.stubEnv('ANTIGRAVITY_COMMAND', agy);
  const q = await import('@/lib/db/queries');
  const workspaceId = q.createWorkspace({ name: 'Personal', cwd: repo, isGit: true, baseBranch: 'main', filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false }).id;
  const created = q.createExecutionWithChat({ workspaceId, harness: 'antigravity', label: 'Agy work' });
  chatId = created.session.id;
  q.updateExecution(created.execution.id, { worktreePath: worktree, branchName: 'feature', baseSha: git(worktree, 'rev-parse', 'HEAD') });
});
afterEach(async () => {
  for (const pid of pids.splice(0)) { try { process.kill(-pid, 'SIGKILL'); } catch { /* */ } try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  await (await import('@/lib/runner/local-runner')).closeAllSessions().catch(() => {});
  (await import('@/lib/executor/adapter'))._resetExecutorState();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup(); vi.unstubAllEnvs();
});

it('Archive confirms the real Antigravity SDK process has exited before removing its worktree', async () => {
  const q = await import('@/lib/db/queries');
  const executor = await import('@/lib/executor/adapter');
  const { archiveExecutionSession } = await import('@/lib/sessions/dispatch');
  const { hasHarnessSession } = await import('@/lib/runner/live-state');
  const event = q.insertChatEvent({ sessionId: chatId, source: 'user', role: 'user', content: 'Hello', createdAt: new Date().toISOString() })!;
  await executor.dispatch(chatId, 'Hello', { sourceEventId: event.id });
  const pid = Number(fs.readFileSync(path.join(home.root, 'agy.pid'), 'utf8')); pids.push(pid);
  expect(alive(pid)).toBe(true);
  expect((await archiveExecutionSession({ sessionId: chatId }))?.status).toBe('archived');
  expect(alive(pid)).toBe(false);
  expect(fs.existsSync(worktree)).toBe(false);
  expect(hasHarnessSession(chatId)).toBe(false);
  expect((await archiveExecutionSession({ sessionId: chatId }))?.status).toBe('archived');
}, 45_000);
