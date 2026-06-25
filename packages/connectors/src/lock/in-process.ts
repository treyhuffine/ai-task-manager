/**
 * In-process mutex — the default `Lock` (§9). Serializes `withLock` calls per
 * key so concurrent actions on one connection trigger exactly one refresh. Each
 * call chains after the previous holder and releases the next on completion.
 */
import type { Lock } from '../core/types';

export function inProcessLock(): Lock {
  const tails = new Map<string, Promise<void>>();
  return {
    async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const prev = tails.get(key) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((r) => (release = r));
      tails.set(key, current);
      await prev.catch(() => undefined); // wait for predecessor; ignore its outcome
      try {
        return await fn();
      } finally {
        release();
        // Drop the entry only if no one chained after us, to bound memory.
        if (tails.get(key) === current) tails.delete(key);
      }
    },
  };
}
