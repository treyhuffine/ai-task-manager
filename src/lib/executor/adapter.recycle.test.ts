import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSession } from '@agentex/agent';
import {
  _cacheHarnessSession,
  _recordBackgroundTaskEvent,
  _resetExecutorState,
  beginDispatchPreparation,
  endDispatchPreparation,
  hasHarnessSession,
  recycleWhenIdle,
} from './adapter';

/**
 * Settings changes recycle live sessions so the next message respawns with
 * the new config (docs/agents-view-spec.md Phase 6). Recycling closes the
 * handle, so a session mid-turn waits for the turn to end: otherwise a main
 * chat that edits its own agent's instructions would cut off the very turn
 * that made the edit.
 */

function fakeHandle() {
  const close = vi.fn(async () => {});
  return { handle: { close } as unknown as AgentSession, close };
}

beforeEach(() => {
  _resetExecutorState();
});

describe('recycleWhenIdle', () => {
  it('preserves detached background work until the final task and provider continuation finish', async () => {
    const { handle, close } = fakeHandle();
    _cacheHarnessSession('background-chat', handle);
    const task = (taskId: string, phase: string, status: string) => ({
      type: 'background_task', taskId, taskType: 'subagent', phase, status,
    });
    _recordBackgroundTaskEvent('background-chat', task('first', 'started', 'running'));
    _recordBackgroundTaskEvent('background-chat', task('last', 'started', 'running'));
    await recycleWhenIdle('background-chat');
    expect(close).not.toHaveBeenCalled();
    _recordBackgroundTaskEvent('background-chat', task('first', 'completed', 'completed'));
    expect(close).not.toHaveBeenCalled();
    _recordBackgroundTaskEvent('background-chat', task('last', 'completed', 'completed'));
    const continuation = beginDispatchPreparation('background-chat');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(close).not.toHaveBeenCalled();
    endDispatchPreparation('background-chat', continuation);
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it('invalidates stale idle handles even when provider teardown fails', async () => {
    const { handle, close } = fakeHandle();
    close.mockRejectedValueOnce(new Error('Provider teardown failed'));
    _cacheHarnessSession('failed-close', handle);
    await recycleWhenIdle('failed-close');
    expect(hasHarnessSession('failed-close')).toBe(false);
  });
  it('scope changes recycle idle surfaces while leaving active turns intact', async () => {
    const idle = fakeHandle();
    const busy = fakeHandle();
    _cacheHarnessSession('app-main', idle.handle);
    _cacheHarnessSession('task-chat', busy.handle);
    const turn = beginDispatchPreparation('task-chat');
    await Promise.all([recycleWhenIdle('app-main'), recycleWhenIdle('task-chat')]);
    expect(idle.close).toHaveBeenCalledOnce();
    expect(busy.close).not.toHaveBeenCalled();
    expect(hasHarnessSession('task-chat')).toBe(true);
    endDispatchPreparation('task-chat', turn);
    await vi.waitFor(() => expect(busy.close).toHaveBeenCalledOnce());
  });

  it('marks an admitted spawn for recycling even before its handle is cached', async () => {
    const turn = beginDispatchPreparation('starting-chat');
    await recycleWhenIdle('starting-chat');
    const started = fakeHandle();
    _cacheHarnessSession('starting-chat', started.handle);
    expect(started.close).not.toHaveBeenCalled();
    endDispatchPreparation('starting-chat', turn);
    await vi.waitFor(() => expect(started.close).toHaveBeenCalledOnce());
  });
  it('recycles an idle session right away', async () => {
    const { handle, close } = fakeHandle();
    _cacheHarnessSession('chat-1', handle);
    await recycleWhenIdle('chat-1');
    expect(hasHarnessSession('chat-1')).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('waits for a running turn to end, then recycles', async () => {
    const { handle, close } = fakeHandle();
    _cacheHarnessSession('chat-1', handle);
    const turn = beginDispatchPreparation('chat-1');

    await recycleWhenIdle('chat-1');
    expect(hasHarnessSession('chat-1')).toBe(true);
    expect(close).not.toHaveBeenCalled();

    endDispatchPreparation('chat-1', turn);
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(hasHarnessSession('chat-1')).toBe(false);
  });

  it('recycles once however many changes land during the turn', async () => {
    const { handle, close } = fakeHandle();
    _cacheHarnessSession('chat-1', handle);
    const turn = beginDispatchPreparation('chat-1');
    await recycleWhenIdle('chat-1');
    await recycleWhenIdle('chat-1');
    endDispatchPreparation('chat-1', turn);
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));

    // A later turn ending does not recycle again.
    const { handle: next, close: closeNext } = fakeHandle();
    _cacheHarnessSession('chat-1', next);
    endDispatchPreparation('chat-1', beginDispatchPreparation('chat-1'));
    await new Promise((r) => setTimeout(r, 10));
    expect(closeNext).not.toHaveBeenCalled();
  });

  it('is a no-op for a session with no live process', async () => {
    await expect(recycleWhenIdle('nobody')).resolves.toBeUndefined();
  });
});
