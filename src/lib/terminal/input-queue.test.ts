import { describe, expect, it, vi } from 'vitest';
import { createInputQueue } from './input-queue';

/** A `send` whose resolution the test controls, recording every batch. */
function controllableSend() {
  const batches: string[] = [];
  const resolvers: Array<() => void> = [];
  const send = (data: string) => {
    batches.push(data);
    return new Promise<void>((resolve) => resolvers.push(resolve));
  };
  return {
    batches,
    send,
    /** Resolve the oldest outstanding request and let the queue advance. */
    async settle() {
      const next = resolvers.shift();
      next?.();
      await Promise.resolve();
      await Promise.resolve();
    },
    outstanding: () => resolvers.length,
  };
}

describe('createInputQueue', () => {
  it('sends the first keystroke immediately, with no batching delay', async () => {
    const t = controllableSend();
    const q = createInputQueue({ send: t.send });

    q.push('a');
    await Promise.resolve();

    // No timer to wait out — latency on an idle queue is the transport's.
    expect(t.batches).toEqual(['a']);
    q.dispose();
  });

  it('coalesces everything typed while a request is in flight', async () => {
    const t = controllableSend();
    const q = createInputQueue({ send: t.send });

    q.push('a');
    await Promise.resolve();
    expect(t.batches).toEqual(['a']);

    // A burst arriving before 'a' resolves becomes one request, not five.
    for (const c of ['b', 'c', 'd', 'e', 'f']) q.push(c);
    expect(t.batches).toEqual(['a']);

    await t.settle();
    expect(t.batches).toEqual(['a', 'bcdef']);
    q.dispose();
  });

  it('keeps exactly one request in flight so bytes cannot transpose', async () => {
    const t = controllableSend();
    const q = createInputQueue({ send: t.send });

    q.push('1');
    await Promise.resolve();
    q.push('2');
    q.push('3');
    await Promise.resolve();

    expect(t.outstanding()).toBe(1);

    await t.settle();
    await t.settle();
    expect(t.batches.join('')).toBe('123');
    q.dispose();
  });

  it('reports a failed flush instead of retrying it', async () => {
    // Replaying a keystroke risks sending it twice, which is worse than
    // losing it — a duplicated `rm` argument is not recoverable.
    const onError = vi.fn();
    const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const q = createInputQueue({ send, onError });

    q.push('x');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('x');
    q.dispose();
  });

  it('recovers after a failure rather than wedging the queue', async () => {
    const onError = vi.fn();
    const send = vi.fn().mockRejectedValueOnce(new Error('blip')).mockResolvedValue(undefined);
    const q = createInputQueue({ send, onError });

    q.push('a');
    for (let i = 0; i < 5; i++) await Promise.resolve();
    q.push('b');
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(send).toHaveBeenNthCalledWith(2, 'b');
    q.dispose();
  });

  it('drops queued bytes once disposed', async () => {
    const t = controllableSend();
    const q = createInputQueue({ send: t.send });

    q.push('a');
    await Promise.resolve();
    q.push('should-not-send');
    q.dispose();
    await t.settle();

    expect(t.batches).toEqual(['a']);

    // Nothing enqueued after dispose reaches the wire either.
    q.push('nor-this');
    await Promise.resolve();
    expect(t.batches).toEqual(['a']);
  });

  it('ignores empty writes', async () => {
    const t = controllableSend();
    const q = createInputQueue({ send: t.send });

    q.push('');
    await Promise.resolve();

    expect(t.batches).toEqual([]);
    q.dispose();
  });
});
