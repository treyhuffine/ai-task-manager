import { describe, expect, it, vi } from 'vitest';
import { createStreamPump, type StreamPumpSteps } from './stream-pump';

/** Steps that record their order, with a recheck the test releases. */
function recorder(over: Partial<StreamPumpSteps> = {}) {
  const log: string[] = [];
  let release: (() => void) | null = null;
  const steps: StreamPumpSteps = {
    stopped: () => false,
    settleStale: () => { log.push('settle'); },
    recheck: () => { log.push('recheck'); return new Promise<void>(resolve => { release = resolve; }); },
    deliver: () => { log.push('deliver'); },
    ...over,
  };
  return { log, steps, release: () => { const done = release; release = null; done?.(); } };
}

describe('a worker stream\'s delivery passes', () => {
  it('checks sends again before the device takes them', async () => {
    const { log, steps, release } = recorder();
    const pass = createStreamPump(steps)();
    expect(log).toEqual(['settle', 'recheck']);
    release();
    await pass;
    expect(log).toEqual(['settle', 'recheck', 'deliver']);
  });

  it('never overlaps passes, and runs one more for wakes during a pass', async () => {
    const { log, steps, release } = recorder();
    const pump = createStreamPump(steps);
    const first = pump();
    // Two wakes while the recheck waits join the same pass and ask for one more.
    expect(pump()).toBe(first);
    expect(pump()).toBe(first);
    release();
    await vi.waitFor(() => expect(log).toEqual(['settle', 'recheck', 'deliver', 'settle', 'recheck']));
    release();
    await first;
    expect(log).toEqual(['settle', 'recheck', 'deliver', 'settle', 'recheck', 'deliver']);
  });

  it('delivers nothing once the stream closes during the check', async () => {
    let closed = false;
    const { log, steps, release } = recorder({ stopped: () => closed });
    const pass = createStreamPump(steps)();
    closed = true;
    release();
    await pass;
    expect(log).toEqual(['settle', 'recheck']);
  });

  it('reports a pass that throws and delivers again on the next wake', async () => {
    const errors: unknown[] = [];
    let fail = true;
    const { log, steps } = recorder({
      recheck: async () => { log.push('recheck'); if (fail) { fail = false; throw new Error('database busy'); } },
      onError: error => errors.push(error),
    });
    const pump = createStreamPump(steps);
    await pump();
    expect(errors).toHaveLength(1);
    await pump();
    expect(log).toEqual(['settle', 'recheck', 'settle', 'recheck', 'deliver']);
  });
});
