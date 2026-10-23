/**
 * Probe (personal Home): real agentex 0.0.47 Claude SDK handle whose CLI ignores SIGTERM, so the
 * SDK's close resolves right after it sends SIGKILL. Unrecorded (the record write or ps lookup
 * failed) vs recorded control. Then the main-chat Restart control on the unconfirmed chat.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getProvider } from '@agentex/agent';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
vi.mock('@/lib/harness/model-discovery', async original => {
  const { explicitHarnessSelection } = await import('@/lib/harness/options');
  return { ...await original<typeof import('@/lib/harness/model-discovery')>(), resolveHarnessSelection: async (providerId: Parameters<typeof explicitHarnessSelection>[0]) => explicitHarnessSelection(providerId, {}) };
});
vi.mock('@/lib/sessions/derive-label', () => ({ deriveRetrospectiveLabel: async () => {} }));

let home: TestHome; let claude: string; const pids: number[] = [];
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1');
  home = await createTestHome({ prefix: 'ri-probe-reap-' });
  claude = path.join(home.root, 'fake-claude');
  fs.writeFileSync(claude, `#!${process.execPath}\nprocess.on('SIGTERM', () => {}); process.stdin.on('data', () => {}); process.stdin.on('end', () => {}); require('node:fs').writeFileSync(${JSON.stringify(path.join(home.root, 'ready-'))} + process.pid, ''); setInterval(() => {}, 1000);\n`, { mode: 0o755 });
});
afterEach(async () => {
  for (const pid of pids.splice(0)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  await (await import('@/lib/runner/local-runner')).closeAllSessions().catch(() => {});
  (await import('@/lib/executor/adapter'))._resetExecutorState();
  await home.cleanup(); vi.unstubAllEnvs();
}, 60_000);

async function liveClaude(chatId: string, recorded: boolean): Promise<number> {
  const { _cacheHarnessSession } = await import('@/lib/runner/local-runner');
  const { recordHarnessProcess } = await import('@/lib/runner/harness-processes');
  const handle = await getProvider('claude').createSession!({ cwd: home.root, config: { command: claude } });
  const pid = (handle as unknown as { proc: { pid: number } }).proc.pid; pids.push(pid);
  for (let i = 0; i < 200 && !fs.existsSync(path.join(home.root, `ready-${pid}`)); i++) await new Promise(r => setTimeout(r, 25));
  if (recorded) await recordHarnessProcess(chatId, pid);
  _cacheHarnessSession(chatId, handle);
  return pid;
}

it.each([['unrecorded', false], ['recorded (control)', true]] as const)('%s: close after SDK SIGKILL escalation, first attempt', async (variant, recorded) => {
  const { close } = await import('@/lib/runner/local-runner');
  const results: unknown[] = [];
  for (let i = 0; i < 1; i++) {
    const id = `chat-${variant}-${i}`;
    const pid = await liveClaude(id, recorded);
    const report = await close(id);
    const t = Date.now(); let stat = ''; try { stat = execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim(); } catch { stat = '(gone)'; }
    while (alive(pid) && Date.now() - t < 5000) await new Promise(r => setTimeout(r, 10));
    results.push({ closed: report.closed, error: report.error?.slice(0, 60), statRightAfter: stat, msUntilEsrch: Date.now() - t });
  }
  expect(results.every(r => (r as { closed: boolean }).closed)).toBe(true);
}, 90_000);

