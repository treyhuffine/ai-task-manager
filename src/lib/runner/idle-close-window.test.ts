/** Probe: the idle sweep's recheck happens before close()'s own awaits (record capture), not before handle.close(). */
import type { AgentSession } from '@agentex/agent';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { _cacheHarnessSession, _resetExecutorState, beginDispatchPreparation, endDispatchPreparation, closeIdleSessions, IDLE_CLOSE_MS } from '@/lib/runner/local-runner';
import { recordHarnessProcess, _resetHarnessProcessState } from '@/lib/runner/harness-processes';
import { isRunning } from '@/lib/runner/live-state';
import * as workerProcesses from '@/lib/service/worker-processes';

let dir: string; const cleanup: number[] = [];
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-probe-idle-')); process.env.RI_WORK_DIR = dir; _resetHarnessProcessState(); _resetExecutorState(); });
afterEach(() => { for (const pid of cleanup.splice(0)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } _resetExecutorState(); vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env.RI_WORK_DIR; vi.useRealTimers(); });

it('does not close a chat whose turn began while the idle sweep awaited its process snapshot', async () => {
  const b = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', 'ri-probe-idle-b'], { stdio: 'ignore' }); cleanup.push(b.pid!);
  await recordHarnessProcess('idle-b', b.pid!);
  const closeB = vi.fn(async () => { b.kill('SIGTERM'); });
  _cacheHarnessSession('idle-b', { proc: b, state: 'idle', close: closeB } as unknown as AgentSession);
  endDispatchPreparation('idle-b', beginDispatchPreparation('idle-b'));
  const entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
  const descendants = workerProcesses.workerDescendants;
  vi.spyOn(workerProcesses, 'workerDescendants').mockImplementation(async pid => {
    if (pid === b.pid) { entered.resolve(); await resume.promise; }
    return descendants(pid);
  });
  const sweep = closeIdleSessions(Date.now() + IDLE_CLOSE_MS + 10);
  await entered.promise;
  const ref = beginDispatchPreparation('idle-b');
  expect(isRunning('idle-b')).toBe(true);
  resume.resolve();
  expect(await sweep).toEqual([]);
  expect(closeB).not.toHaveBeenCalled(); expect(isRunning('idle-b')).toBe(true);
  endDispatchPreparation('idle-b', ref);
}, 15_000);
