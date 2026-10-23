/**
 * Probe (personal Home): real agentex 0.0.47 Cursor session through Ri dispatch and the real
 * archive. The installed Cursor CLI (`~/.local/bin/agent`) is a bash launcher that probes node and
 * then `exec -a "$0" node index.js "$@"`: same PID and start time, different command line. Ri records
 * the per-turn PID from the lifecycle event while the launcher is still bash. The turn starts a tool
 * process in its own process group (as tool runners do so they can kill it), which agentex's group
 * kill does not reach. Ri's close captures descendants before closing so it can stop them.
 * Control: the same turn program run directly (no exec launcher).
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
vi.mock('@/lib/sessions/derive-label', () => ({ deriveRetrospectiveLabel: vi.fn(async () => {}), syncSessionTitle: vi.fn(async () => {}) }));

let home: TestHome; let chatId: string; let worktree: string;
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).toString().trim();
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const ps = (pid: number) => { try { return execFileSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim(); } catch { return '(gone)'; } };
const pidsOf = (name: string) => { try { return fs.readFileSync(path.join(home.root, name), 'utf8').split('\n').filter(Boolean).map(Number); } catch { return []; } };

function install(launcher: boolean) {
  const index = path.join(home.root, 'cursor-dist', 'index.js');
  fs.mkdirSync(path.dirname(index), { recursive: true });
  fs.writeFileSync(index, `
if (process.argv.includes('models') || process.argv.includes('--list-models')) { console.log(JSON.stringify([{ id: 'fake', name: 'Fixture model' }])); process.exit(0); }
if (!process.argv.includes('-p')) process.exit(0);
const fs = require('node:fs'); const { spawn } = require('node:child_process');
fs.appendFileSync(${JSON.stringify(path.join(home.root, 'turn.pids'))}, process.pid + '\\n');
// A tool command, started in its own process group as tool runners do.
const tool = spawn(process.execPath, [${JSON.stringify(path.join(home.root, 'cursor-dist', 'tool.js'))}], { cwd: process.cwd(), detached: true, stdio: 'ignore' });
tool.unref(); fs.appendFileSync(${JSON.stringify(path.join(home.root, 'tool.pids'))}, tool.pid + '\\n');
process.on('SIGTERM', () => {});
process.stdin.resume();
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'cursor-probe', model: 'fake' }) + '\\n');
setInterval(() => {}, 1000);
`);
  fs.writeFileSync(path.join(home.root, 'cursor-dist', 'tool.js'), `setInterval(() => require('node:fs').writeFileSync(${JSON.stringify(path.join(home.root, 'tool.beat'))}, String(Date.now())), 200);\n`);
  const bin = path.join(home.root, 'bin', 'agent');
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  if (launcher) {
    // Same shape as ~/.local/share/cursor-agent/versions/*/cursor-agent.
    fs.symlinkSync(process.execPath, path.join(home.root, 'cursor-dist', 'node'));
    fs.writeFileSync(path.join(home.root, 'cursor-dist', 'cursor-agent'), `#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(dirname "$(realpath "$0")")"
NODE_BIN="$SCRIPT_DIR/node"
if "$NODE_BIN" --version >/dev/null 2>&1; then
  exec -a "$0" "$NODE_BIN" "$SCRIPT_DIR/index.js" "$@"
fi
exec -a "$0" "$NODE_BIN" "$SCRIPT_DIR/index.js" "$@"
`, { mode: 0o755 });
    fs.symlinkSync(path.join(home.root, 'cursor-dist', 'cursor-agent'), bin);
  } else {
    fs.writeFileSync(bin, `#!${process.execPath}\nrequire(${JSON.stringify(index)});\n`, { mode: 0o755 });
  }
  vi.stubEnv('CURSOR_COMMAND', bin);
}

beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1');
  home = await createTestHome({ prefix: 'ri-probe-cursor-exec-' });
  for (const other of ['CLAUDE_COMMAND', 'CODEX_COMMAND', 'OPENCODE_COMMAND', 'ANTIGRAVITY_COMMAND']) vi.stubEnv(other, path.join(home.root, 'no-such-harness'));
  const identity = await import('@/lib/home/identity'); identity.resetHomeIdentityCache(); identity.ensureHomeIdentity();
  const repo = path.join(home.root, 'repo'); fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main'); git(repo, 'config', 'user.name', 'P'); git(repo, 'config', 'user.email', 'p@example.invalid');
  fs.writeFileSync(path.join(repo, 'README.md'), 'base\n'); git(repo, 'add', '.'); git(repo, 'commit', '-q', '-m', 'base');
  worktree = path.join(home.root, 'wt'); git(repo, 'worktree', 'add', '-q', '-b', 'feature', worktree, 'main');
  const q = await import('@/lib/db/queries');
  const workspaceId = q.createWorkspace({ name: 'Personal', cwd: repo, isGit: true, baseBranch: 'main', filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false }).id;
  const created = q.createExecutionWithChat({ workspaceId, harness: 'cursor', label: 'Cursor work' });
  chatId = created.session.id;
  q.updateExecution(created.execution.id, { worktreePath: worktree, branchName: 'feature', baseSha: git(worktree, 'rev-parse', 'HEAD') });
});
afterEach(async () => {
  for (const pid of [...pidsOf('turn.pids'), ...pidsOf('tool.pids')]) { try { process.kill(-pid, 'SIGKILL'); } catch { /* */ } try { process.kill(pid, 'SIGKILL'); } catch { /* */ } }
  await (await import('@/lib/runner/local-runner')).closeAllSessions().catch(() => {});
  (await import('@/lib/executor/adapter'))._resetExecutorState();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup(); vi.unstubAllEnvs();
}, 60_000);

it.each([['exec launcher', true], ['direct node (control)', false]] as const)('Archive with Cursor %s stops the turn\'s tool process before removing the worktree', async (variant, launcher) => {
  install(launcher);
  const q = await import('@/lib/db/queries');
  const executor = await import('@/lib/executor/adapter');
  const { harnessProcessRecordPath } = await import('@/lib/runner/harness-processes');
  const { archiveExecutionSession } = await import('@/lib/sessions/dispatch');
  const event = q.insertChatEvent({ sessionId: chatId, source: 'user', role: 'user', content: 'Work', createdAt: new Date().toISOString() })!;
  void executor.dispatch(chatId, 'Work', { sourceEventId: event.id }).catch(() => {});
  await vi.waitFor(() => expect(pidsOf('tool.pids').length).toBe(1), { timeout: 15_000 });
  await new Promise(resolve => setTimeout(resolve, 800));
  const [turn] = pidsOf('turn.pids'); const [tool] = pidsOf('tool.pids');
  const record = JSON.parse(fs.readFileSync(harnessProcessRecordPath(), 'utf8')).entries as Array<{ process: { pid: number; command: string } }>;
  const recorded = record.find(entry => entry.process.pid === turn)?.process.command ?? '(not recorded)';
  const live = ps(turn);
  const t0 = Date.now();
  const result = await archiveExecutionSession({ sessionId: chatId }).then(r => `archived ${r?.status}`).catch(e => `refused: ${(e as Error).message}`);
  const ms = Date.now() - t0;
  await new Promise(resolve => setTimeout(resolve, 500));
  const beatAge = Date.now() - Number(fs.readFileSync(path.join(home.root, 'tool.beat'), 'utf8'));
  const observed = { variant, result, ms, recordedCommand: recorded.slice(0, 90), liveCommandBeforeClose: live.slice(0, 90), identityMatched: recorded === live,
    turnAlive: alive(turn), toolAlive: alive(tool), toolBeatAgeMs: beatAge, worktreeExists: fs.existsSync(worktree) };
  expect(result).toBe('archived archived');
  expect(observed.toolAlive).toBe(false);
  expect(observed.worktreeExists).toBe(false);
  // Policy: a known live process (here the recorded turn's own tool child) never loses its worktree.
  expect(observed.worktreeExists && observed.toolAlive ? 'kept' : observed.toolAlive ? 'tool alive, worktree removed' : 'stopped').not.toBe('tool alive, worktree removed');
}, 60_000);
