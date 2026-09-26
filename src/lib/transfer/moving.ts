/**
 * While work moves to another computer (docs/homes-spec.md §8.2, P4.5), the
 * controls that change it wait. Its source is being stopped and saved, and
 * the destination doesn't have it yet, so a file edit, a push, bringing in
 * the base branch, a merge, or archiving would race the move. Messages are
 * held instead (the adapter), and everything works again the moment the
 * destination owns the work.
 */

import { getActiveTransfer, getChatSession, getComputer } from '@/lib/db/queries';

/** The computer the execution is moving to, while its source still has it. */
export function movingTo(executionId: string | null | undefined): string | null {
  if (!executionId) return null;
  const moving = getActiveTransfer(executionId);
  if (!moving || moving.toGeneration !== null) return null;
  return getComputer(moving.toComputerId)?.name ?? 'another computer';
}

export function movingMessage(to: string): string {
  return `It's moving to ${to}. Try again once it has arrived there.`;
}

/** A 409 that says so, or null when nothing is moving. */
export function refuseWhileMoving(chatSessionId: string): Response | null {
  const to = movingTo(getChatSession(chatSessionId)?.executionId);
  if (!to) return null;
  return Response.json({ error: 'moving', code: 'moving', message: movingMessage(to) }, { status: 409 });
}

export class ExecutionMovingError extends Error {
  readonly code = 'moving';
  constructor(to: string) {
    super(movingMessage(to));
    this.name = 'ExecutionMovingError';
  }
}
