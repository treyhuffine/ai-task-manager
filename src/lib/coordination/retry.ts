import { ExecutorError } from '@/lib/runner/errors';
import { ServerTransportError, ServerResponseError } from '@/lib/orchestrator/server-client';

/** Only failures known to precede native acceptance may retry automatically. */
export function retryableCoordinationDispatch(error: unknown): boolean {
  return error instanceof ExecutorError && ['already_running', 'budget_exceeded'].includes(error.code)
    || error instanceof ServerTransportError
    || error instanceof ServerResponseError && (error.status >= 500 || [408, 425, 429].includes(error.status));
}
