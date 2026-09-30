/**
 * The home's live worker connections, and the requests waiting on them
 * (docs/homes-build.md, "P2.2 Enrollment and the worker connection").
 *
 * Each worker holds one event stream open (`/api/workers/me/stream`). A
 * reconnect can briefly overlap the stream it replaces, so the newest one
 * receives what's sent. A request is a read with a timeout: the home sends
 * it down the stream and the worker answers over HTTP. Nothing here is
 * persisted. Kept on globalThis so every route bundle shares it.
 */

import { readMaintenance } from '@/lib/service/maintenance';
import { uuidv7 } from 'uuidv7';
import {
  WORKER_REQUEST_TIMEOUT_MS,
  type WorkerRequestKind,
  type WorkerRequestResult,
  type WorkerStreamEvent,
} from './protocol';

export interface WorkerConnection {
  readonly id: string;
  readonly deviceId: string;
  readonly openedAt: number;
  readonly capabilities?: readonly string[];
  send(event: WorkerStreamEvent): void;
  /** Send whatever commands are waiting for this device. */
  wake(): void;
  close(): void;
}

interface PendingRequest {
  deviceId: string;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface HubState {
  connections: Map<string, WorkerConnection[]>;
  pending: Map<string, PendingRequest>;
}

const HUB_KEY = Symbol.for('@ri/worker-hub');
const globalRef = globalThis as unknown as { [HUB_KEY]?: HubState };
if (!globalRef[HUB_KEY]) globalRef[HUB_KEY] = { connections: new Map(), pending: new Map() };
const hub = globalRef[HUB_KEY]!;

export class WorkerUnavailableError extends Error {
  constructor(readonly deviceId: string) {
    super('That device is not connected to its home right now.');
    this.name = 'WorkerUnavailableError';
  }
}

export class WorkerRequestError extends Error {
  constructor(
    message: string,
    readonly unsupported = false,
  ) {
    super(message);
    this.name = 'WorkerRequestError';
  }
}

/** Track a newly opened stream. Returns the function that forgets it. */
export function registerConnection(connection: WorkerConnection): () => void {
  const list = hub.connections.get(connection.deviceId) ?? [];
  hub.connections.set(connection.deviceId, [...list, connection]);
  return () => {
    const remaining = (hub.connections.get(connection.deviceId) ?? []).filter((c) => c.id !== connection.id);
    if (remaining.length > 0) hub.connections.set(connection.deviceId, remaining);
    else hub.connections.delete(connection.deviceId);
  };
}

/** A command was queued for this device: its stream sends it now, if it's connected. */
export function wakeDevice(deviceId: string): void {
  const connection = newest(deviceId);
  try {
    connection?.wake();
  } catch (err) {
    console.warn(`[workers] could not wake the stream of ${deviceId}:`, err);
  }
}

/** Send one event to a device's worker, when it's connected. Says whether it was sent. */
export function sendToWorker(deviceId: string, event: WorkerStreamEvent): boolean {
  const connection = newest(deviceId);
  if (!connection) return false;
  try {
    connection.send(event);
    return true;
  } catch {
    return false;
  }
}

export function isDeviceConnected(deviceId: string): boolean {
  return (hub.connections.get(deviceId)?.length ?? 0) > 0;
}

function newest(deviceId: string): WorkerConnection | null {
  const list = hub.connections.get(deviceId);
  if (!list || list.length === 0) return null;
  return list.reduce((a, b) => (b.openedAt >= a.openedAt ? b : a));
}

/**
 * Ask a connected worker something and wait for its answer. Throws
 * `WorkerUnavailableError` when it isn't connected, and `WorkerRequestError`
 * when it answers with an error, doesn't know the request, or doesn't answer
 * in time.
 */
export function requestWorker(
  deviceId: string,
  kind: WorkerRequestKind,
  payload: unknown = null,
  timeoutMs = WORKER_REQUEST_TIMEOUT_MS,
  requiredCapability = 'worker.protocol4',
): Promise<unknown> {
  if (readMaintenance()) return Promise.reject(new WorkerRequestError('The Home is preparing an update. Please retry shortly.'));
  const connection = newest(deviceId);
  if (!connection) return Promise.reject(new WorkerUnavailableError(deviceId));
  if (!(connection.capabilities ?? ['worker.protocol4']).includes(requiredCapability)) {
    return Promise.reject(new WorkerRequestError(`Update Ri on this device before using ${requiredCapability}.`, true));
  }
  const id = uuidv7();
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      hub.pending.delete(id);
      reject(new WorkerRequestError(`The device didn't answer within ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
    timer.unref?.();
    hub.pending.set(id, { deviceId, resolve, reject, timer });
    try {
      connection.send({ type: 'request', id, kind, payload });
    } catch {
      clearTimeout(timer);
      hub.pending.delete(id);
      reject(new WorkerUnavailableError(deviceId));
    }
  });
}

/**
 * A worker's answer to a request. Only the device that was asked can
 * answer. Returns false for an unknown, expired or someone else's request.
 */
export function settleRequest(deviceId: string, requestId: string, result: WorkerRequestResult): boolean {
  const pending = hub.pending.get(requestId);
  if (!pending || pending.deviceId !== deviceId) return false;
  hub.pending.delete(requestId);
  clearTimeout(pending.timer);
  if (result.ok) pending.resolve(result.value);
  else pending.reject(new WorkerRequestError(result.error, result.unsupported === true));
  return true;
}

/** Tell every stream of a device it was revoked, and close them. */
export function disconnectDevice(deviceId: string, message: string): void {
  for (const connection of hub.connections.get(deviceId) ?? []) {
    try {
      connection.send({ type: 'revoked', message });
    } catch {
      /* already closed */
    }
    connection.close();
  }
  hub.connections.delete(deviceId);
}

/** Test helper: drop a device's streams without revoking it, as a network failure would. */
export function _dropWorkerStreams(deviceId: string): void {
  for (const connection of hub.connections.get(deviceId) ?? []) connection.close();
}

/** Test helper. */
export function _resetWorkerHub(): void {
  for (const pending of hub.pending.values()) clearTimeout(pending.timer);
  hub.pending.clear();
  hub.connections.clear();
}
