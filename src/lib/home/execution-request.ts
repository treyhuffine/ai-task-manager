import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestKey } from '@/lib/auth/request-key';
import { processState } from '@/lib/process-state';

const state = processState('home:execution-request', () => ({ scope: new AsyncLocalStorage<RequestKey>() }));

/** Installed only after a transport authenticates a member. Async scopes do not cross requests. */
export function withExecutionRequest<T>(key: RequestKey, work: () => T): T {
  return state.scope.run({ ...key }, work);
}
export function executionRequestKey(): RequestKey | null { return state.scope.getStore() ?? null; }
