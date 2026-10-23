/**
 * Probe (personal Home): real agentex 0.0.47 Claude session through Ri dispatch (recorded PID),
 * idle after a completed turn. A settings/model change recycles it exactly as PATCH
 * /api/sessions/:id and recycleWorkspaceSessions do (fire-and-forget recycleForModeChange), and
 * the person archives the execution a moment later. The stand-in ignores SIGTERM, so the recycle's
 * SDK close takes its 5s grace before SIGKILL.
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
vi.mock('@/lib/sessions/derive-label', () => ({ deriveRetrospectiveLabel: vi.fn(async () => {}), syncSessionTitle: vi.fn(async () => {}), deriveAndSetSessionLabel: vi.fn(async () => {}) }));

let home: TestHome; let chatId: string; let worktree: string; let workspaceId: string;
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).toString().trim();
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const spawns = () => { try { return fs.readFileSync(path.join(home.root, 'spawns.log'), 'utf8').split('\n').filter(Boolean).map(Number); } catch { return []; } };

beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1');
  home = await createTestHome({ prefix: 'ri-probe-recycle-archive-' });
  for (const other of ['CODEX_COMMAND', 'CURSOR_COMMAND', 'OPENCODE_COMMAND', 'ANTIGRAVITY_COMMAND']) vi.stubEnv(other, path.join(home.root, 'no-such-harness'));
  const identity = await import('@/lib/home/identity'); identity.resetHomeIdentityCache(); identity.ensureHomeIdentity();
  const repo = path.join(home.root, 'repo'); fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main'); git(repo, 'config', 'user.name', 'P'); git(repo, 'config', 'user.email', 'p@example.invalid');
  fs.writeFileSync(path.join(repo, 'README.md'), 'base\n'); git(repo, 'add', '.'); git(repo, 'commit', '-q', '-m', 'base');
  worktree = path.join(home.root, 'wt'); git(repo, 'worktree', 'add', '-q', '-b', 'feature', worktree, 'main');
  const fake = path.join(home.root, 'fake-claude');
  fs.writeFileSync(fake, `#!${process.execPath}
const fs = require('node:fs');
if (!process.argv.includes('--input-format')) { if (process.argv.includes('--version')) console.log('2.1.300 (Claude Code)'); process.exit(0); }
fs.appendFileSync(${JSON.stringify(path.join(home.root, 'spawns.log'))}, process.pid + '\\n');
process.on('SIGTERM', () => {});
const out = m => process.stdout.write(JSON.stringify(m) + '\\n');
let buf = '';
process.stdin.on('data', chunk => { buf += chunk; let i; while ((i = buf.indexOf('\\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1);
  let msg; try { msg = JSON.parse(line); } catch { continue; }
  if (msg.type !== 'user') continue;
  out({ type: 'system', subtype: 'init', session_id: 'claude-probe', model: 'fake', tools: [] });
  out({ type: 'result', subtype: 'success', session_id: 'claude-probe', is_error: false, result: 'ok', num_turns: 1, duration_ms: 1, total_cost_usd: 0, usage: {} });
} });
process.stdin.on('end', () => {});
setInterval(() => {}, 1000);
`, { mode: 0o755 });
  vi.stubEnv('CLAUDE_COMMAND', fake);
  const q = await import('@/lib/db/queries');
  workspaceId = q.createWorkspace({ name: 'Personal', cwd: repo, isGit: true, baseBranch: 'main', filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false }).id;
  const created = q.createExecutionWithChat({ workspaceId, harness: 'claude', label: 'Claude work' });
  chatId = created.session.id;
  q.updateExecution(created.execution.id, { worktreePath: worktree, branchName: 'feature', baseSha: git(worktree, 'rev-parse', 'HEAD') });
});
afterEach(async () => {
  for (const pid of spawns()) { try { process.kill(pid, 'SIGKILL'); } catch { /* */ } }
  await (await import('@/lib/runner/local-runner')).closeAllSessions().catch(() => {});
  (await import('@/lib/executor/adapter'))._resetExecutorState();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup(); vi.unstubAllEnvs();
}, 60_000);

it.each(['recycleForModeChange (PATCH model/effort/mode)', 'recycleWorkspaceSessions (agent settings change)'] as const)('Archive right after %s keeps the worktree until the recorded harness has exited', async how => {
  const q = await import('@/lib/db/queries');
  const executor = await import('@/lib/executor/adapter');
  const { runnerState } = await import('@/lib/runner/live-state');
  const { harnessProcessRecordPath } = await import('@/lib/runner/harness-processes');
  const { POST: archive } = await import('@/lib/server/operations/sessions/[id]/archive');
  const event = q.insertChatEvent({ sessionId: chatId, source: 'user', role: 'user', content: 'Work', createdAt: new Date().toISOString() })!;
  await executor.dispatch(chatId, 'Work', { sourceEventId: event.id });
  await vi.waitFor(() => expect(runnerState.runningSessions.has(chatId)).toBe(false), { timeout: 10_000 });
  await new Promise(resolve => setTimeout(resolve, 300));
  const [pid] = spawns();
  const recordedBefore = JSON.parse(fs.readFileSync(harnessProcessRecordPath(), 'utf8')).entries.some((e: { process: { pid: number } }) => e.process.pid === pid);
  if (how.startsWith('recycleForModeChange')) void executor.recycleForModeChange(chatId).catch(() => {});
  else void executor.recycleWorkspaceSessions(workspaceId).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 200));
  const t0 = Date.now();
  const result = await archive({ params: { id: chatId }, body: {} } as never, { headers: new Headers() } as never) as { status: number };
  const observed = { how, recordedBefore, archiveStatus: result.status, ms: Date.now() - t0, harnessAliveAtArchiveEnd: alive(pid), worktreeExists: fs.existsSync(worktree), status: q.getChatSession(chatId)?.status };
  expect(observed.recordedBefore).toBe(true);
  expect(observed.archiveStatus).toBe(200);
  expect(observed.harnessAliveAtArchiveEnd).toBe(false);
  expect(observed.worktreeExists).toBe(false);
  expect(observed.status).toBe('archived');
}, 60_000);
