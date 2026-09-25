/**
 * Pending prompts, as the home sees them. The store lives with the runner
 * (`src/lib/runner/pending.ts`), because the harness waits on the runner's
 * computer. Changes publish through the home sink, installed here so a
 * route that only touches prompts still publishes. Answers go through
 * `answerPendingInput` in the adapter, which asks the chat's runner.
 */

import { installHomeSink } from './home-sink';

installHomeSink();

export type {
  PendingInput,
  PendingInputKind,
  PendingPermission,
  PendingQuestion,
} from '@/lib/runner/pending';
export {
  register,
  resolveRequest,
  rejectAllForSession,
  listForSession,
  listSessionsWithPending,
  getPending,
  _resetPendingInput,
} from '@/lib/runner/pending';
export { classifyRequest } from '@/lib/runner/pending-classify';
