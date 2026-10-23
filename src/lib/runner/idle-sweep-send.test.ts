/**
 * Probe (personal Home): real agentex 0.0.47 Claude session through Ri dispatch (recorded PID).
 * The stand-in completes turns and, like a CLI flushing its history, takes 1.5s to exit after stdin
 * EOF. (a) The idle sweep closes it on the first try. (b) A message the person sends while that
 * invisible sweep close is in flight: on main the closing handle was treated as dead and a new
 * session must start only after the old close confirms, without refusing the send.
 * (c) Same with a CLI that ignores SIGTERM (SIGKILL needed).
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
vi.mock('@/lib/harness/runtime', async original => {
  const { fakeHarnessRuntime, fakeHarnessAuth } = await import('@/test/fixtures/harness-runtime');
  return { ...await original<typeof import('@/lib/harness/runtime')>(), getHarnessRuntime: fakeHarnessRuntime, resolveHarnessAuth: fakeHarnessAuth };
});
vi.mock('@/lib/harness/model-discovery', async original => {
  const { explicitHarnessSelection } = await import('@/lib/harness/options');
  return { ...await original<typeof import('@/lib/harness/model-discovery')>(), resolveHarnessSelection: async (providerId: Parameters<typeof explicitHarnessSelection>[0]) => explicitHarnessSelection(providerId, {}) };
});
vi.mock('@/lib/sessions/derive-label', () => ({ deriveRetrospectiveLabel: vi.fn(async () => {}), syncSessionTitle: vi.fn(async () => {}), deriveAndSetSessionLabel: vi.fn(async () => {}) }));

let home: TestHome;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const spawns = () => { try { return fs.readFileSync(path.join(home.root, 'spawns.log'), 'utf8').split('\n').filter(Boolean).map(Number); } catch { return []; } };

function install(ignoreTerm: boolean) {
  const fake = path.join(home.root, 'fake-claude');
  fs.writeFileSync(fake, `#!${process.execPath}
const fs = require('node:fs');
if (!process.argv.includes('--input-format')) { if (process.argv.includes('--version')) console.log('2.1.300 (Claude Code)'); process.exit(0); }
fs.appendFileSync(${JSON.stringify(path.join(home.root, 'spawns.log'))}, process.pid + '\\n');
${ignoreTerm ? "process.on('SIGTERM', () => {});" : "process.on('SIGTERM', () => setTimeout(() => process.exit(0), 1500));"}
const out = m => process.stdout.write(JSON.stringify(m) + '\\n');
let buf = '';
process.stdin.on('data', chunk => { buf += chunk; let i; while ((i = buf.indexOf('\\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1);
  let msg; try { msg = JSON.parse(line); } catch { continue; }
  if (msg.type !== 'user') continue;
  const text = typeof msg.message.content === 'string' ? msg.message.content : JSON.stringify(msg.message.content);
  fs.appendFileSync(${JSON.stringify(path.join(home.root, 'turns.log'))}, process.pid + ' ' + text.slice(-40).replace(/\\n/g, ' ') + '\\n');
  out({ type: 'system', subtype: 'init', session_id: 'claude-probe', model: 'fake', tools: [] });
  out({ type: 'assistant', session_id: 'claude-probe', message: { id: 'm' + Date.now(), role: 'assistant', content: [{ type: 'text', text: 'ok' }] } });
  out({ type: 'result', subtype: 'success', session_id: 'claude-probe', is_error: false, result: 'ok', num_turns: 1, duration_ms: 1, total_cost_usd: 0, usage: {} });
} });
process.stdin.on('end', ${ignoreTerm ? '() => {}' : '() => setTimeout(() => process.exit(0), 1500)'});
setInterval(() => {}, 1000);
`, { mode: 0o755 });
  vi.stubEnv('CLAUDE_COMMAND', fake);
}

beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1');
  home = await createTestHome({ prefix: 'ri-probe-idle-send-' });
  for (const other of ['CODEX_COMMAND', 'CURSOR_COMMAND', 'OPENCODE_COMMAND', 'ANTIGRAVITY_COMMAND']) vi.stubEnv(other, path.join(home.root, 'no-such-harness'));
  const identity = await import('@/lib/home/identity'); identity.resetHomeIdentityCache(); identity.ensureHomeIdentity();
});
afterEach(async () => {
  for (const pid of spawns()) { try { process.kill(pid, 'SIGKILL'); } catch { /* */ } }
  await (await import('@/lib/runner/local-runner')).closeAllSessions().catch(() => {});
  (await import('@/lib/executor/adapter'))._resetExecutorState();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup(); vi.unstubAllEnvs();
}, 60_000);

it.each([['slow EOF exit', false], ['ignores SIGTERM', true]] as const)('idle sweep (%s): first-try close, and a message sent during it', async (variant, ignoreTerm) => {
  install(ignoreTerm);
  const q = await import('@/lib/db/queries');
  const mc = await import('@/lib/sessions/main-chat');
  const runner = await import('@/lib/runner/local-runner');
  const { runnerState } = await import('@/lib/runner/live-state');
  const { POST: sendMessage } = await import('@/lib/server/operations/sessions/[id]/messages');
  const chat = await mc.startNewMainChat(null, { providerId: 'claude' });
  const ctx = { headers: new Headers() } as never;
  const first = await sendMessage({ params: { id: chat.id }, body: { content: 'first message' } } as never, ctx) as { status: number };
  await vi.waitFor(() => expect(fs.existsSync(path.join(home.root, 'turns.log'))).toBe(true), { timeout: 15_000 });
  await vi.waitFor(() => expect(runnerState.runningSessions.has(chat.id)).toBe(false), { timeout: 10_000 });
  await new Promise(resolve => setTimeout(resolve, 300));
  const [pid] = spawns();
  runnerState.lastActivityAt.set(chat.id, Date.now() - runner.IDLE_CLOSE_MS - 1000);
  const t0 = Date.now();
  const sweep = runner.closeIdleSessions();
  await new Promise(resolve => setTimeout(resolve, 300));
  const during = await sendMessage({ params: { id: chat.id }, body: { content: 'second message, typed as the sweep ran' } } as never, ctx) as { status: number };
  const closed = await sweep; const sweepMs = Date.now() - t0;
  await new Promise(resolve => setTimeout(resolve, 2500));
  const events = q.listChatEvents(chat.id).map((e: { source: string; content?: string | null; raw?: unknown }) => `${e.source}:${((e.raw as { subtype?: string } | null)?.subtype ?? '')}:${(e.content ?? '').slice(0, 60)}`);
  const observed = { variant, firstStatus: first.status, duringStatus: during.status, closedBySweep: closed.includes(chat.id), sweepMs, oldAlive: alive(pid),
    turns: fs.readFileSync(path.join(home.root, 'turns.log'), 'utf8').trim().split('\n'), events: events.filter(e => !e.startsWith('system')).slice(-6) };
  expect(observed.firstStatus).toBe(201);
  expect(observed.duringStatus).toBe(201);
  expect(observed.oldAlive).toBe(false);
  expect(observed.closedBySweep).toBe(true);
  expect(observed.turns.filter(line => line.includes('typed as the sweep ran'))).toHaveLength(1);
}, 60_000);
