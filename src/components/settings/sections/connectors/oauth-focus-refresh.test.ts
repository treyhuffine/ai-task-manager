import { describe, expect, it, vi } from 'vitest';
import { watchOAuthReturn } from './oauth-focus-refresh';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

describe('registered browser sign-in return', () => {
  it('keeps abandoned consent retryable and stops watching once authorization succeeds', async () => {
    const target = new EventTarget();
    const refresh = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const complete = vi.fn();
    const failed = vi.fn();
    watchOAuthReturn(target, refresh, complete, failed);
    target.dispatchEvent(new Event('focus'));
    await flush();
    expect(complete).not.toHaveBeenCalled();
    target.dispatchEvent(new Event('focus'));
    await flush();
    expect(complete).toHaveBeenCalledOnce();
    target.dispatchEvent(new Event('focus'));
    await flush();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(failed).not.toHaveBeenCalled();
  });

  it('does not complete an obsolete sign-in after cancellation or a new attempt replaces it', async () => {
    const target = new EventTarget();
    let finish!: (value: boolean) => void;
    const refresh = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const complete = vi.fn();
    const stop = watchOAuthReturn(target, refresh, complete, vi.fn());
    target.dispatchEvent(new Event('focus'));
    target.dispatchEvent(new Event('focus'));
    expect(refresh).toHaveBeenCalledOnce();
    stop();
    finish(true);
    await flush();
    expect(complete).not.toHaveBeenCalled();
    target.dispatchEvent(new Event('focus'));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('can retry a transient status failure without losing the pending sign-in', async () => {
    const target = new EventTarget();
    const error = new Error('Temporary network error');
    const refresh = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(true);
    const complete = vi.fn();
    const failed = vi.fn();
    watchOAuthReturn(target, refresh, complete, failed);
    target.dispatchEvent(new Event('focus'));
    await flush();
    expect(failed).toHaveBeenCalledExactlyOnceWith(error);
    target.dispatchEvent(new Event('focus'));
    await flush();
    expect(complete).toHaveBeenCalledOnce();
  });
});
