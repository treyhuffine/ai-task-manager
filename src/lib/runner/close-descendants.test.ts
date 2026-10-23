/** Probe: a timed-out close escalates to the tracked harness PID. What happens to the harness's own children? Real Node stand-ins. */
import type { AgentSession } from '@agentex/agent';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { _cacheHarnessSession, _resetExecutorState, close } from '@/lib/runner/local-runner';
import { recordHarnessProcess, _resetHarnessProcessState } from '@/lib/runner/harness-processes';
import { hasHarnessSession } from '@/lib/runner/live-state';

let dir: string; const cleanup: number[] = [];
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-probe-close-')); vi.stubEnv('RI_WORK_DIR', dir); _resetHarnessProcessState(); });
afterEach(() => { for (const pid of cleanup.splice(0)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } _resetExecutorState(); fs.rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

it('a bounded close stops the exact harness and its captured tool descendant', async () => {
  const pidFile = path.join(dir, 'grandchild.pid');
  // Stand-in harness: ignores SIGTERM (busy), runs a long tool subprocess of its own, as a Bash tool call would.
  const script = `process.on('SIGTERM', () => {}); const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', 'ri-probe-tool'], { stdio: 'ignore' }); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); setInterval(() => {}, 1000);`;
  const harness = spawn(process.execPath, ['-e', script, '--', 'ri-probe-harness'], { stdio: 'ignore' });
  cleanup.push(harness.pid!);
  for (let i = 0; i < 100 && !fs.existsSync(pidFile); i++) await new Promise(r => setTimeout(r, 50));
  const tool = Number(fs.readFileSync(pidFile, 'utf8')); cleanup.push(tool);
  await recordHarnessProcess('hung-chat', harness.pid!);
  const handle = { proc: harness, state: 'idle', close: () => new Promise<void>(() => {}) } as unknown as AgentSession;
  _cacheHarnessSession('hung-chat', handle);
  const result = await close('hung-chat');
  await new Promise(r => setTimeout(r, 200));
  const observed = { result, harnessAlive: alive(harness.pid!), toolAlive: alive(tool), cached: hasHarnessSession('hung-chat') };
  expect(observed.result.closed).toBe(true);
  expect(observed.harnessAlive).toBe(false);
  expect(observed.toolAlive).toBe(false);
}, 30_000);