import { describe, expect, it } from 'vitest';
import { AsyncSemaphore } from './async-semaphore';

/** Resolves after a microtask/macrotask so overlap is observable. */
function tick(ms = 1): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('AsyncSemaphore', () => {
  it('never runs more tasks at once than its permit count', async () => {
    const sem = new AsyncSemaphore(3);
    let inFlight = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        sem.run(async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await tick();
          inFlight -= 1;
        }),
      ),
    );
    expect(peak).toBe(3);
    expect(inFlight).toBe(0);
  });

  it('returns the resolved value of the wrapped task', async () => {
    const sem = new AsyncSemaphore(1);
    expect(await sem.run(async () => 42)).toBe(42);
  });

  it('releases the permit when a task throws, so it cannot starve the pool', async () => {
    const sem = new AsyncSemaphore(1);
    await expect(
      sem.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // If the failed task leaked its only permit, this would hang forever.
    expect(await sem.run(async () => 'recovered')).toBe('recovered');
    expect(sem.available).toBe(1);
    expect(sem.waiting).toBe(0);
  });

  it('hands a freed permit to a queued waiter, draining every task', async () => {
    const sem = new AsyncSemaphore(2);
    const order: number[] = [];
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        sem.run(async () => {
          order.push(i);
          await tick();
        }),
      ),
    );
    expect(order.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(sem.available).toBe(2);
  });

  it('clamps a non-positive bound to a usable floor instead of deadlocking', async () => {
    const sem = new AsyncSemaphore(0);
    expect(sem.available).toBe(1);
    expect(await sem.run(async () => 'ok')).toBe('ok');
  });
});
