import { afterEach, describe, expect, it, vi } from 'vitest';
import { withTimeout } from './runtime';

afterEach(() => { vi.useRealTimers(); });

describe('MCP operation timeouts', () => {
  it('clears successful operation timers so completed discovery does not keep running timers', async () => {
    vi.useFakeTimers();
    expect(await withTimeout(Promise.resolve('ready'), 10_000, 'connect')).toBe('ready');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up a client that finishes connecting after its timeout', async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    let finish!: (client: { close: () => void }) => void;
    const delayed = new Promise<{ close: () => void }>((resolve) => { finish = resolve; });
    const result = withTimeout(delayed, 100, 'connect', (client) => client.close());
    const failure = expect(result).rejects.toThrow('connect timed out after 100ms');
    await vi.advanceTimersByTimeAsync(100);
    await failure;
    finish({ close });
    await vi.runAllTimersAsync();
    expect(close).toHaveBeenCalledOnce();
  });

  it('does not clean up a live successful client', async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn();
    expect(await withTimeout(Promise.resolve('ready'), 100, 'connect', cleanup)).toBe('ready');
    await vi.advanceTimersByTimeAsync(100);
    expect(cleanup).not.toHaveBeenCalled();
  });
});
