/**
 * How a worker calls its home (docs/homes-build.md, P2.2). Every request
 * carries the worker key and the protocol version. A 426, 401 or 403 means
 * the worker must stop, not retry: the home speaks another protocol, or this
 * computer's local execution was turned off.
 */

import os from 'node:os';
import { APP_SHORT_ID } from '@/constants/app';
import { WORKER_PROTOCOL, WORKER_PROTOCOL_HEADER } from '@/lib/workers/protocol';

export interface WorkerTarget {
  homeUrl: string;
  homeId: string;
  homeName: string;
  computerName: string;
  workerKey: string;
}

export type WorkerStopReason = 'revoked' | 'protocol' | 'wrong_home';

/** The home told this worker to stop. Retrying won't help. */
export class WorkerStoppedError extends Error {
  constructor(
    readonly reason: WorkerStopReason,
    message: string,
  ) {
    super(message);
    this.name = 'WorkerStoppedError';
  }
}

/** The home couldn't be reached, or answered with a passing failure. Retry later. */
export class WorkerNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerNetworkError';
  }
}

export const WORKER_REQUEST_TIMEOUT_MS = 15_000;

export async function workerFetch(
  target: WorkerTarget,
  path: string,
  init: RequestInit & { timeoutMs?: number | null } = {},
): Promise<Response> {
  const { timeoutMs = WORKER_REQUEST_TIMEOUT_MS, headers, signal, ...rest } = init;
  const timeout = timeoutMs === null ? null : AbortSignal.timeout(timeoutMs);
  const combined = signal && timeout ? AbortSignal.any([signal, timeout]) : signal ?? timeout ?? undefined;
  let res: Response;
  try {
    res = await fetch(`${target.homeUrl}${path}`, {
      ...rest,
      signal: combined,
      headers: {
        authorization: `Bearer ${target.workerKey}`,
        [WORKER_PROTOCOL_HEADER]: String(WORKER_PROTOCOL),
        'user-agent': `${APP_SHORT_ID}-worker (${os.hostname()})`,
        ...(rest.body ? { 'content-type': 'application/json' } : {}),
        ...(headers as Record<string, string> | undefined),
      },
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new WorkerNetworkError(`Cannot reach ${target.homeName} at ${target.homeUrl}.`);
  }
  if (res.status === 426) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new WorkerStoppedError('protocol', body?.message ?? `Update Ri on ${target.computerName}.`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new WorkerStoppedError(
      'revoked',
      `${target.homeName} no longer accepts this computer as a worker. Enroll it again to run agents here.`,
    );
  }
  if (res.status >= 500) {
    throw new WorkerNetworkError(`${target.homeName} answered with HTTP ${res.status}.`);
  }
  return res;
}
