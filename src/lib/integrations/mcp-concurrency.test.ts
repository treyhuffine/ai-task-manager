import { describe, expect, it, vi } from 'vitest';
import { withMcpCallSlot } from './mcp-concurrency';

function gate() {
  let finish!: () => void;
  const promise = new Promise<void>(resolve => { finish = resolve; });
  return { promise, finish };
}

describe('MCP account concurrency', () => {
  it('runs a fourteen-call burst in FIFO order at three calls per account', async () => {
    const gates = Array.from({ length: 14 }, gate);
    const started: number[] = [];
    let active = 0;
    let peak = 0;
    const work = gates.map((g, index) => withMcpCallSlot('burst', 3, async () => {
      started.push(index);
      peak = Math.max(peak, ++active);
      await g.promise;
      active--;
      return index;
    }));
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));
    for (let i = 0; i < gates.length; i++) {
      gates[i]!.finish();
      await vi.waitFor(() => expect(started).toHaveLength(Math.min(i + 4, gates.length)));
    }
    expect(await Promise.all(work)).toEqual(Array.from({ length: 14 }, (_, i) => i));
    expect(peak).toBe(3);
    expect(started).toEqual(Array.from({ length: 14 }, (_, i) => i));
  });

  it('shares slots across module copies while keeping accounts independent and freeing failed slots', async () => {
    const g = gate();
    const first = withMcpCallSlot('copies', 1, async () => { await g.promise; throw new Error('timeout'); }).catch(error => error);
    vi.resetModules();
    const other = await import('./mcp-concurrency');
    const run = vi.fn(async () => 'queued');
    const queued = other.withMcpCallSlot('copies', 1, run);
    expect(await other.withMcpCallSlot('other-account', 1, async () => 'independent')).toBe('independent');
    expect(run).not.toHaveBeenCalled();
    g.finish();
    expect(await first).toBeInstanceOf(Error);
    expect(await queued).toBe('queued');
  });

  it('removes cancelled waiters without dispatching them or blocking the next caller', async () => {
    const g = gate();
    const first = withMcpCallSlot('cancel', 1, () => g.promise);
    const controller = new AbortController();
    const send = vi.fn(async () => 'must not send');
    const cancelled = withMcpCallSlot('cancel', 1, send, controller.signal).catch(error => error);
    const next = withMcpCallSlot('cancel', 1, async () => 'next');
    controller.abort();
    expect(await cancelled).toMatchObject({ code: 'denied', indeterminate: false });
    expect(send).not.toHaveBeenCalled();
    g.finish();
    await first;
    expect(await next).toBe('next');
    await expect(withMcpCallSlot('cancel', 1, send, controller.signal)).rejects.toMatchObject({ code: 'denied' });
  });

  it.each([0, -1, 1.5, NaN])('rejects invalid limits without retaining a queue: %s', async limit => {
    await expect(withMcpCallSlot('invalid', limit, async () => {})).rejects.toBeInstanceOf(RangeError);
    expect(await withMcpCallSlot('invalid', 1, async () => 'usable')).toBe('usable');
  });
});
