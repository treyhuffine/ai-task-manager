/**
 * The home and worker protocol's constants and messages (docs/homes-build.md,
 * "P2 protocol" and "P2.2 Enrollment and the worker connection"). Plain
 * data, shared by both sides.
 */

import { APP_SHORT_ID } from '@/constants/app';
import type {
  CreateChatEventInput,
  WorkerCommandActor,
  WorkerCommandKind,
  WorkerHarnessReport,
  WorkerReportedState,
} from '@/db/types';
import type { RunnerSignal } from '@/lib/runner/types';

/** The protocol this build speaks. A home refuses a worker on another one with 426. */
export const WORKER_PROTOCOL = 1;
export const WORKER_PROTOCOL_HEADER = `x-${APP_SHORT_ID}-worker-protocol`;

export const WORKER_HEARTBEAT_MS = 20_000;
export const WORKER_STREAM_PING_MS = 15_000;
/** How long the home waits for a worker to answer a request. */
export const WORKER_REQUEST_TIMEOUT_MS = 15_000;

/** Reads the home can ask a worker. Never persisted. */
export type WorkerRequestKind = 'describe_harnesses';

/** A command as the stream carries it (P2 protocol, Commands). */
export interface WorkerCommand {
  /** UUIDv7, stable: the idempotency key. */
  id: string;
  /** Per computer, set when first streamed: where a stream resumes. */
  seq: number;
  kind: WorkerCommandKind;
  target: { executionId: string | null; chatSessionId: string | null; generation: number | null };
  actor: WorkerCommandActor;
  issuedAt: string;
  payload: unknown;
}

export type WorkerCommandAckState = 'delivered' | 'failed' | 'stale' | 'uncertain';

export interface WorkerCommandAckBody {
  state: WorkerCommandAckState;
  result?: unknown;
  error?: string | null;
}

/** A chat event as a worker journals it. The envelope names the chat; the row never does. */
export type WorkerChatEvent = Omit<CreateChatEventInput, 'sessionId' | 'id'>;

/** One entry of a worker's event journal (P2 protocol, Events). */
export type WorkerEvent = {
  /** Contiguous from 1 in this computer's journal. */
  position: number;
  /** UUIDv7 minted when the worker parsed it; a chat event's id. */
  eventId: string;
  generation: number | null;
  chatSessionId: string;
  occurredAt: string;
} & (
  | { kind: 'chat_event'; chatEvent: WorkerChatEvent; cumulative: boolean }
  | { kind: 'signal'; signal: RunnerSignal }
);

export type WorkerStreamEvent =
  | { type: 'hello'; homeId: string; computerId: string; protocol: number; ackedEventSeq: number }
  | { type: 'command'; command: WorkerCommand }
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
