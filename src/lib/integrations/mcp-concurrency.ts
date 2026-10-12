import { IntegrationError } from '@integrations/engine';
import { processState } from '@/lib/process-state';

interface Waiter { start: () => void; cancel: () => void }
interface Pool { active: number; limit: number; waiting: Waiter[] }
const pools = processState('integrations.mcp-concurrency', () => new Map<string, Pool>());
const cancelled = () => new IntegrationError('denied', 'The queued request was cancelled. No request was sent.');

/** One account's upstream slots are shared across chats, bundles and runtime refreshes. */
export async function withMcpCallSlot<T>(key: string, limit: number, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('MCP concurrency limit must be a positive integer.');
  if (signal?.aborted) throw cancelled();
  const pool = pools.get(key) ?? { active: 0, limit, waiting: [] };
  pools.set(key, pool);
  pool.limit = limit;
  const releasePool = () => {
    if (pool.active === 0 && pool.waiting.length === 0 && pools.get(key) === pool) pools.delete(key);
  };
  const pump = () => {
    while (pool.active < pool.limit && pool.waiting.length) {
      pool.active += 1;
      pool.waiting.shift()!.start();
    }
  };
  await new Promise<void>((resolve, reject) => {
    const waiter: Waiter = {
      start() { signal?.removeEventListener('abort', waiter.cancel); resolve(); },
      cancel() {
        const index = pool.waiting.indexOf(waiter);
        if (index < 0) return;
        pool.waiting.splice(index, 1);
        signal?.removeEventListener('abort', waiter.cancel);
        releasePool();
        reject(cancelled());
      },
    };
    signal?.addEventListener('abort', waiter.cancel, { once: true });
    pool.waiting.push(waiter);
    pump();
  });
  try {
    if (signal?.aborted) throw cancelled();
    return await operation();
  } finally {
    pool.active -= 1;
    pump();
    releasePool();
  }
}
