/**
 * Waiting on a turn at the home. A runner reports each turn's end as
 * `turn_result`, wherever it runs, and the home sink settles the waiter
 * here. `dispatch` uses it to keep returning when the turn ends, so callers
 * holding a lease or a timeout still work, while the run itself is finished
 * by the signal (`finishRun`) whether anyone waits or not.
 */

interface Waiter {
  resolve: () => void;
  reject: (err: Error) => void;
}

const WAITERS_KEY = Symbol.for('@ri/turn-waiters');
const globalRef = globalThis as unknown as { [WAITERS_KEY]?: Map<string, Waiter> };
if (!globalRef[WAITERS_KEY]) globalRef[WAITERS_KEY] = new Map();
const waiters = globalRef[WAITERS_KEY]!;

/** Start waiting on a turn. Register before sending, so an early result can't be missed. */
export function awaitTurn(turnId: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    waiters.set(turnId, { resolve, reject });
  });
}

/** Settle a turn's waiter, if anyone is waiting. `error` null means the turn ended normally. */
export function settleTurn(turnId: string, error: string | null): void {
  const waiter = waiters.get(turnId);
  if (!waiter) return;
  waiters.delete(turnId);
  if (error === null) waiter.resolve();
  else waiter.reject(new Error(error));
}

/** Stop waiting on a turn that was never delivered. */
export function forgetTurn(turnId: string): void {
  waiters.delete(turnId);
}
