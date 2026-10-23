import type { AgentSession } from '@agentex/agent';
import { afterEach, expect, it, vi } from 'vitest';
import { _cacheHarnessSession, _resetExecutorState, close, SESSION_CLOSE_TIMEOUT_MS } from './local-runner';
import { hasHarnessSession } from './live-state';

afterEach(() => { _resetExecutorState(); vi.useRealTimers(); });
it('bounds a close that never settles and retains the handle when no tracked process can be stopped', async () => {
  vi.useFakeTimers();
  _cacheHarnessSession('unconfirmed-close', { close: () => new Promise<void>(() => {}) } as unknown as AgentSession);
  const pending = close('unconfirmed-close');
  await vi.advanceTimersByTimeAsync(SESSION_CLOSE_TIMEOUT_MS + 1);
  expect(await pending).toMatchObject({ closed: false, error: expect.stringContaining('did not confirm') });
  expect(hasHarnessSession('unconfirmed-close')).toBe(true);
});
