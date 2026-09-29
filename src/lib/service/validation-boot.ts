import { getDb } from '@/lib/db';

/** Only SQLite initialization is permitted before the coordinator commits.
 * The new controller restarts normally only after the durable commit. */
declare global { var __riPrepareIdle: (() => Promise<void>) | undefined; }

export function validationBoot(): boolean {
  getDb(); // fail startup, rather than swallow incompatible history
  if (process.env.RI_SERVICE_VALIDATING !== '1') {
    globalThis.__riPrepareIdle = async () => (await import('@/lib/executor/adapter')).closeIdleHarnessesForMaintenance();
    return false;
  }
  return true;
}
