/**
 * The home and worker protocol's constants and messages (docs/homes-build.md,
 * "P2 protocol" and "P2.2 Enrollment and the worker connection"). Plain
 * data, shared by both sides.
 */

import { APP_SHORT_ID } from '@/constants/app';
import type { WorkerHarnessReport, WorkerReportedState } from '@/db/types';

/** The protocol this build speaks. A home refuses a worker on another one with 426. */
export const WORKER_PROTOCOL = 1;
export const WORKER_PROTOCOL_HEADER = `x-${APP_SHORT_ID}-worker-protocol`;

export const WORKER_HEARTBEAT_MS = 20_000;
export const WORKER_STREAM_PING_MS = 15_000;
/** How long the home waits for a worker to answer a request. */
export const WORKER_REQUEST_TIMEOUT_MS = 15_000;

/** Reads the home can ask a worker. Never persisted. */
export type WorkerRequestKind = 'describe_harnesses';

export type WorkerStreamEvent =
  | { type: 'hello'; homeId: string; computerId: string; protocol: number }
  | { type: 'request'; id: string; kind: WorkerRequestKind; payload: unknown }
  | { type: 'revoked'; message: string }
  | { type: 'ping' };

export interface WorkerHeartbeat {
  protocol: number;
  version: string;
  harnesses: WorkerHarnessReport[];
  state: WorkerReportedState;
}

export type WorkerRequestResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string; unsupported?: boolean };

/** What a home says to a worker on another protocol. */
export function protocolMismatchMessage(computerName: string): string {
  return `Update Ri on ${computerName}. It speaks a different version of the home and worker protocol than this home.`;
}
