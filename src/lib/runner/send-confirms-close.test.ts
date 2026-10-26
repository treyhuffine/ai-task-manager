/** A send, or a mode change, retries an unconfirmed close itself instead of asking for Restart. */
import type { AgentSession } from '@agentex/agent';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { _cacheHarnessSession, _resetExecutorState, close, recycleForModeChange, recycleWhenIdle, send, setCloseUnconfirmed } from '@/lib/runner/local-runner';
import { _resetHarnessProcessState } from '@/lib/runner/harness-processes';
import { hasHarnessSession, runnerState } from '@/lib/runner/live-state';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-send-close-')); process.env.RI_WORK_DIR = dir; _resetHarnessProcessState(); _resetExecutorState(); });
afterEach(() => { _resetExecutorState(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env.RI_WORK_DIR; });

const request = (chatSessionId: string) => ({ chatSessionId, message: 'Hello', turnId: 'turn', runId: null, spec: null });
function cache(chatSessionId: string, sdkClose: () => Promise<void>) {
  const sdkSend = vi.fn();
  _cacheHarnessSession(chatSessionId, { state: 'idle', close: sdkClose, send: sdkSend } as unknown as AgentSession);
  return sdkSend;
}

it('a send retries an earlier failed close, and starts fresh once it confirms', async () => {
  const sdkClose = vi.fn().mockRejectedValueOnce(new Error('Shutdown failed')).mockResolvedValue(undefined);
  const sdkSend = cache('chat', sdkClose);
  expect(await close('chat')).toMatchObject({ closed: false });
  expect(runnerState.unconfirmedCloses.has('chat')).toBe(true);
  // No live handle remains, so a send without a spec reports it needs one: it got past the block.
  expect(await send(request('chat'))).toEqual({ status: 'needs_spec' });
  expect(sdkClose).toHaveBeenCalledTimes(2); expect(sdkSend).not.toHaveBeenCalled();
  expect(runnerState.unconfirmedCloses.has('chat')).toBe(false); expect(hasHarnessSession('chat')).toBe(false);
});

it('a send makes one fresh attempt and refuses with the reason when the old harness still will not confirm', async () => {
  const sdkClose = vi.fn().mockRejectedValue(new Error('Shutdown failed'));
  const sdkSend = cache('stuck', sdkClose);
  await close('stuck');
  await expect(send(request('stuck'))).rejects.toMatchObject({ code: 'already_running', message: "Shutdown failed. Ri won't start another harness beside it. Saved changes are preserved. Try again in a moment to check once more." });
  expect(sdkClose).toHaveBeenCalledTimes(2); expect(sdkSend).not.toHaveBeenCalled();
  expect(hasHarnessSession('stuck')).toBe(true); expect(runnerState.unconfirmedCloses.has('stuck')).toBe(true);
});

it('a close in flight when the send arrives is joined, and counts as its attempt', async () => {
  const gate = Promise.withResolvers<void>();
  const sdkClose = vi.fn(() => gate.promise);
  cache('closing', sdkClose);
  const closing = close('closing');
  const sending = send(request('closing'));
  gate.reject(new Error('Idle cleanup failed'));
  await expect(sending).rejects.toMatchObject({ code: 'already_running', message: expect.stringMatching(/^Idle cleanup failed\. /) });
  await closing;
  expect(sdkClose).toHaveBeenCalledOnce();
});

it('names the surviving processes when they are known', async () => {
  cache('named', vi.fn().mockRejectedValue(new Error('Shutdown failed')));
  setCloseUnconfirmed('named', true, 'pid 123 (node) is still running. Your next message checks again.');
  await expect(send(request('named'))).rejects.toThrow('pid 123 (node) is still running. Your next message checks again.');
});

it('a mode change retries an earlier unconfirmed close rather than asking for Restart', async () => {
  const sdkClose = vi.fn().mockRejectedValueOnce(new Error('Shutdown failed')).mockResolvedValue(undefined);
  cache('mode', sdkClose);
  await close('mode');
  await expect(recycleForModeChange('mode')).resolves.toBeUndefined();
  expect(sdkClose).toHaveBeenCalledTimes(2); expect(runnerState.unconfirmedCloses.has('mode')).toBe(false);
});

it('a settings recycle leaves a chat already awaiting confirmation to its next send', async () => {
  const sdkClose = vi.fn().mockRejectedValue(new Error('Shutdown failed'));
  cache('settings', sdkClose);
  await close('settings');
  await expect(recycleWhenIdle('settings')).resolves.toBeUndefined();
  expect(sdkClose).toHaveBeenCalledOnce(); expect(runnerState.unconfirmedCloses.has('settings')).toBe(true);
});
