/** Probe: the common idle sweep acts on a stale idle list after a bounded (timed-out) close of another chat. */
import type { AgentSession } from '@agentex/agent';
import { afterEach, expect, it, vi } from 'vitest';
import { _cacheHarnessSession, _resetExecutorState, beginDispatchPreparation, endDispatchPreparation, closeIdleSessions, IDLE_CLOSE_MS, SESSION_CLOSE_TIMEOUT_MS } from '@/lib/runner/local-runner';
import { hasHarnessSession } from '@/lib/runner/live-state';
import { isRunning } from '@/lib/runner/live-state';

afterEach(() => { _resetExecutorState(); vi.useRealTimers(); });

it('does not close a chat that became busy while an earlier idle close was timing out', async () => {
  vi.useFakeTimers();
  const hung = { close: () => new Promise<void>(() => {}) } as unknown as AgentSession;
  const closeB = vi.fn(async () => {});
  const b = { close: closeB } as unknown as AgentSession;
  _cacheHarnessSession('idle-a', hung);
  _cacheHarnessSession('idle-b', b);
  for (const id of ['idle-a', 'idle-b']) endDispatchPreparation(id, beginDispatchPreparation(id));
  const sweep = closeIdleSessions(Date.now() + IDLE_CLOSE_MS + 10);
  await Promise.resolve();
  // A member turn starts on B while A's close is unconfirmed.
  const ref = beginDispatchPreparation('idle-b');
  expect(isRunning('idle-b')).toBe(true);
  await vi.advanceTimersByTimeAsync(SESSION_CLOSE_TIMEOUT_MS + 1);
  expect(await sweep).toEqual([]);
  endDispatchPreparation('idle-b', ref);
  expect(closeB).not.toHaveBeenCalled();
  expect(hasHarnessSession('idle-b')).toBe(true);
});