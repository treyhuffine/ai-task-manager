/** Review7 probe: a completed SDK close rejection must permit a fresh attempt (ef30357b fix), a pending one must be joined. */
import type { AgentSession } from '@agentex/agent';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { _cacheHarnessSession, _resetExecutorState, close } from '@/lib/runner/local-runner';
import { _resetHarnessProcessState } from '@/lib/runner/harness-processes';
import { hasHarnessSession, runnerState } from '@/lib/runner/live-state';
let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-r7-close-')); process.env.RI_WORK_DIR = dir; _resetHarnessProcessState(); _resetExecutorState(); });
afterEach(() => { _resetExecutorState(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env.RI_WORK_DIR; });
it('a rejected close is retried with a new SDK call and then confirms', async () => {
  const sdkClose = vi.fn().mockRejectedValueOnce(new Error('Close refused')).mockResolvedValue(undefined);
  _cacheHarnessSession('rejected', { state: 'idle', close: sdkClose } as unknown as AgentSession);
  const first = await close('rejected');
  expect(first).toMatchObject({ closed: false, error: 'Close refused' });
  expect(hasHarnessSession('rejected')).toBe(true);
  expect(runnerState.unconfirmedCloses.has('rejected')).toBe(true);
  const second = await close('rejected');
  expect(sdkClose).toHaveBeenCalledTimes(2);
  expect(second.closed).toBe(true);
  expect(hasHarnessSession('rejected')).toBe(false);
});
it('a synchronous throw from close is also retryable', async () => {
  let n = 0;
  const sdkClose = vi.fn(() => { if (n++ === 0) throw new Error('sync refuse'); return Promise.resolve(); });
  _cacheHarnessSession('sync', { state: 'idle', close: sdkClose } as unknown as AgentSession);
  expect((await close('sync')).closed).toBe(false);
  expect((await close('sync')).closed).toBe(true);
  expect(sdkClose).toHaveBeenCalledTimes(2);
});
