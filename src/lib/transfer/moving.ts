/**
 * The one boundary between moving work and everything else that touches it
 * (docs/homes-spec.md §8.2, P4.5, and the P4 review's fourth finding).
 *
 * While work moves to another device, its source is being stopped and
 * saved and the destination doesn't have it yet. Every operation on an
 * execution passes through here in the same tick as it starts: a send to its
 * harness, a Git or file change, archiving, a new terminal. While a move is
 * under way it's refused (a send is held instead, by the adapter), and
 * otherwise it's counted until it ends. A move starts only when no change is
 * in flight (`busyWith`), and stops the source only once the sends already
 * admitted have reached it (`drainSends`). So nothing let in before the lock
 * lands on a source that has been stopped and saved, and nothing deletes it
 * underneath a move.
 *
 * In memory, because every such operation runs in the home's own process,
 * and so does every move. A check at the start of a long operation isn't
 * enough: this holds for as long as the operation runs.
 */

import { getActiveTransfer, getChatSession, getDevice } from '@/lib/db/queries';

/** The device the execution is moving to, while its source still has it. */
export function movingTo(executionId: string | null | undefined): string | null {
  if (!executionId) return null;
  const moving = getActiveTransfer(executionId);
  if (!moving || moving.toGeneration !== null) return null;
  return getDevice(moving.toDeviceId)?.name ?? 'another device';
}

export function movingMessage(to: string): string {
  return `It's moving to ${to}. Try again once it has arrived there.`;
}

export class ExecutionMovingError extends Error {
  readonly code = 'moving';
  constructor(to: string) {
    super(movingMessage(to));
    this.name = 'ExecutionMovingError';
  }
}

/** A 409 that says so. */
export function movingResponse(to: string): Response {
  return Response.json({ error: 'moving', code: 'moving', message: movingMessage(to) }, { status: 409 });
}

/** A 409 that says so, or null when nothing is moving. */
export function refuseWhileMoving(chatSessionId: string): Response | null {
  const to = movingTo(getChatSession(chatSessionId)?.executionId);
  return to ? movingResponse(to) : null;
}

// ─── What's in flight on each execution ──────────────────────────────

interface Operation {
  /** How a refused move names it: "archiving", "pushing". */
  what: string;
  kind: 'send' | 'change';
}

// On globalThis: a dev server reloading this module mustn't forget what's in flight.
const KEY = Symbol.for('@ri/execution-operations');
const holder = globalThis as unknown as { [KEY]?: Map<string, Map<symbol, Operation>> };
const inFlight: Map<string, Map<symbol, Operation>> = (holder[KEY] ??= new Map());

function register(executionId: string, operation: Operation): () => void {
  const token = Symbol(operation.what);
  let ops = inFlight.get(executionId);
  if (!ops) inFlight.set(executionId, (ops = new Map()));
  ops.set(token, operation);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = inFlight.get(executionId);
    current?.delete(token);
    if (current && current.size === 0) inFlight.delete(executionId);
  };
}

/**
 * Let a change to the execution through: its release when it ends, and it's
 * refused while the execution moves. Check and count happen together.
 */
export function admitChange(executionId: string | null | undefined, what: string): () => void {
  if (!executionId) return () => {};
  const to = movingTo(executionId);
  if (to) throw new ExecutionMovingError(to);
  return register(executionId, { what, kind: 'change' });
}

/**
 * The same around a whole route: a 409 while it moves, otherwise `run` with
 * the change counted until its response is ready.
 */
export async function whileAdmitted(chatSessionId: string, what: string, run: () => Promise<Response>): Promise<Response> {
  let release: () => void;
  try {
    release = admitChange(getChatSession(chatSessionId)?.executionId, what);
  } catch (err) {
    if (err instanceof ExecutionMovingError) return Response.json({ error: 'moving', code: 'moving', message: err.message }, { status: 409 });
    throw err;
  }
  try {
    return await run();
  } finally {
    release();
  }
}

/**
 * A send about to reach the execution's harness: its release once the
 * harness has it, or null while it moves (the adapter holds the message).
 */
export function admitSend(executionId: string | null | undefined): (() => void) | null {
  if (!executionId) return () => {};
  if (movingTo(executionId)) return null;
  return register(executionId, { what: 'sending a message', kind: 'send' });
}

/** A change in flight that a move can't start under, by name, or null. */
export function busyWith(executionId: string): string | null {
  for (const op of inFlight.get(executionId)?.values() ?? []) if (op.kind === 'change') return op.what;
  return null;
}

/** Wait until the sends already admitted have reached the harness. False when they didn't in time. */
export async function drainSends(executionId: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const sending = [...(inFlight.get(executionId)?.values() ?? [])].some((op) => op.kind === 'send');
    if (!sending) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** For tests. */
export function _resetExecutionOperations(): void {
  inFlight.clear();
}
