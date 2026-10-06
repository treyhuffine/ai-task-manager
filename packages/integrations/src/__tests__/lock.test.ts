import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inProcessLock, fileLock } from '../lock';
import type { Lock } from '../core/types';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function assertMutualExclusion(lock: Lock, key = 'k'): Promise<void> {
  let active = 0;
  let maxActive = 0;
  const task = () =>
    lock.withLock(key, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(5);
      active--;
      return null;
    });
  await Promise.all([task(), task(), task()]);
  expect(maxActive).toBe(1);
}

describe('inProcessLock (§9)', () => {
  it('serializes same-key access (mutual exclusion)', async () => {
    await assertMutualExclusion(inProcessLock());
  });

  it('allows different keys to run concurrently', async () => {
    const lock = inProcessLock();
    let concurrent = 0;
    let max = 0;
    const task = (k: string) =>
      lock.withLock(k, async () => {
        concurrent++;
        max = Math.max(max, concurrent);
        await sleep(5);
        concurrent--;
      });
    await Promise.all([task('a'), task('b'), task('c')]);
    expect(max).toBeGreaterThan(1);
  });

  it('releases the lock even when the body throws', async () => {
    const lock = inProcessLock();
    await expect(lock.withLock('k', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    // A subsequent acquire must not hang.
    await expect(lock.withLock('k', async () => 'ok')).resolves.toBe('ok');
  });
});

describe('fileLock (§9, cross-process advisory)', () => {
  it('serializes same-key access via the filesystem', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'connlock-'));
    try {
      await assertMutualExclusion(fileLock({ dir, retryMs: 2 }));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
