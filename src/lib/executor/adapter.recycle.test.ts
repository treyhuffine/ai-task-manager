import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSession } from '@agentex/agent';
import {
  _cacheHarnessSession,
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
