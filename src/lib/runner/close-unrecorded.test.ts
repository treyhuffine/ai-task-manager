/** Probe: close() of a cached handle whose process is not (or no longer) in the harness record. Real Node stand-ins. */
import type { AgentSession } from '@agentex/agent';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { _cacheHarnessSession, _resetExecutorState, close, isHarnessSessionAlive, invalidateHarnessSession } from '@/lib/runner/local-runner';
import { recordHarnessProcess, _resetHarnessProcessState } from '@/lib/runner/harness-processes';
import { hasHarnessSession, runnerState } from '@/lib/runner/live-state';

let dir: string; const cleanup: number[] = [];
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-probe-unrec-')); process.env.RI_WORK_DIR = dir; _resetHarnessProcessState(); _resetExecutorState(); });
afterEach(() => { vi.useRealTimers(); for (const pid of cleanup.splice(0)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } _resetExecutorState(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env.RI_WORK_DIR; });

it('a retry after the deadline joins the original SDK close until it actually finishes', async () => {
  vi.useFakeTimers();
  const pending = Promise.withResolvers<void>();
  const sdkClose = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
  _cacheHarnessSession('late-sdk', { state: 'idle', close: sdkClose } as unknown as AgentSession);
  const first = close('late-sdk');
  await vi.advanceTimersByTimeAsync(10_100);
  expect((await first).closed).toBe(false);
  const retry = close('late-sdk');
  await vi.advanceTimersByTimeAsync(0);
  expect(sdkClose).toHaveBeenCalledTimes(1);
  pending.resolve();
  expect((await retry).closed).toBe(true);
  expect(hasHarnessSession('late-sdk')).toBe(false);
});

it('a harness that exited before the runner recorded it can still be closed', async () => {
  // As startSession: createSession returned a handle whose CLI exited at once (bad flag, auth,
  // resume id). recordProcess(pid) then finds no process and writes nothing.
  const child = spawn(process.execPath, ['-e', 'process.exit(3)'], { stdio: 'ignore' });
  await once(child, 'exit');
  await recordHarnessProcess('dead-at-start', child.pid!);
  let closeCalls = 0;
  const handle = { proc: child, state: 'closed', close: async () => { closeCalls++; } } as unknown as AgentSession;
  _cacheHarnessSession('dead-at-start', handle);
  const first = await close('dead-at-start');
  const second = await close('dead-at-start');
  invalidateHarnessSession('dead-at-start');
  const observed = { alive: isHarnessSessionAlive('dead-at-start'), first, second, closeCalls,
    cachedAfter: hasHarnessSession('dead-at-start'), unconfirmed: runnerState.unconfirmedCloses.has('dead-at-start') };
  expect(first.closed).toBe(true);
  expect(observed.cachedAfter).toBe(false);
}, 30_000);

it('two overlapping closes of one live recorded harness both report closed', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', 'ri-probe-overlap'], { stdio: 'ignore' });
  cleanup.push(child.pid!);
  await new Promise(r => setTimeout(r, 100));
  await recordHarnessProcess('overlap', child.pid!);
  // agentex Claude: close() is memoized (_closePromise); a later caller gets an already-settled promise.
  let closing: Promise<void> | null = null;
  const handle = { proc: child, state: 'idle', close: () => closing ??= (async () => { child.kill('SIGTERM'); await once(child, 'exit'); })() } as unknown as AgentSession;
  _cacheHarnessSession('overlap', handle);
  const a = close('overlap');
  // A second control (AI off / member removal / idle sweep / close chat) arrives after the first
  // close's harness exit but before its record cleanup finished.
  await once(child, 'exit');
  const b = close('overlap');
  const [ra, rb] = await Promise.all([a, b]);
  const observed = { a: ra, b: rb, cached: hasHarnessSession('overlap'), unconfirmed: runnerState.unconfirmedCloses.has('overlap') };
  expect({ a: ra.closed, b: rb.closed, unconfirmed: observed.unconfirmed }).toEqual({ a: true, b: true, unconfirmed: false });
}, 30_000);

it('keeps a live unrecorded root retryable without signaling an unidentified process', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  cleanup.push(child.pid!);
  await new Promise(resolve => setTimeout(resolve, 100));
  const handle = { proc: child, state: 'idle', close: async () => {} } as unknown as AgentSession;
  _cacheHarnessSession('live-unrecorded', handle);
  expect((await close('live-unrecorded')).closed).toBe(false);
  expect(() => process.kill(child.pid!, 0)).not.toThrow();
  expect(hasHarnessSession('live-unrecorded')).toBe(true);
  const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
  expect((await close('live-unrecorded')).closed).toBe(true);
  expect(hasHarnessSession('live-unrecorded')).toBe(false);
}, 30_000);


it('confirms a recorded harness even after its cached handle was lost', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  cleanup.push(child.pid!, unrelated.pid!);
  await new Promise(resolve => setTimeout(resolve, 100));
  await recordHarnessProcess('missing-handle', child.pid!);
  expect(hasHarnessSession('missing-handle')).toBe(false);
  expect((await close('missing-handle')).closed).toBe(true);
  expect(() => process.kill(child.pid!, 0)).toThrow();
  expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();
}, 30_000);
