/**
 * The worker's connection to its home (docs/homes-build.md, P2.2).
 *
 * It holds the home's event stream open and answers what arrives, sends a
 * heartbeat every 20 seconds, and reconnects when the connection drops, with
 * backoff from 1 to 30 seconds. It stops for good only when the home says so:
 * the key was revoked, the home speaks another protocol, or the address now
 * answers for another home. A stream that goes quiet for three ping
 * intervals is treated as dropped, since a half-open connection never errors
 * on its own.
 *
 * Runs on the connected computer, so it never touches a database.
 */

import type { WorkerHarnessReport } from '@/db/types';
import {
  WORKER_HEARTBEAT_MS,
  WORKER_PROTOCOL,
  WORKER_STREAM_PING_MS,
  type WorkerHeartbeat,
  type WorkerRequestKind,
  type WorkerRequestResult,
  type WorkerStreamEvent,
} from '@/lib/workers/protocol';
import type { RunnerSink } from '@/lib/runner/types';
import { WorkerNetworkError, WorkerStoppedError, workerFetch, type WorkerStopReason, type WorkerTarget } from './client';
import { CommandJournal } from './command-journal';
import { CommandProcessor, type CommandHandlers } from './commands';
import { EventJournal } from './event-journal';
import { describeHarnesses } from './harnesses';
import { EventPoster } from './poster';
import { createWorkerSink } from './sink';
import { readEventStream } from './sse';

export type WorkerExit = { reason: 'stopped' } | { reason: WorkerStopReason; message: string };

export type WorkerStatus =
  | { state: 'connecting'; attempt: number }
  | { state: 'connected' }
  | { state: 'disconnected'; error: string; retryInMs: number };

export type RequestHandler = (kind: WorkerRequestKind, payload: unknown) => Promise<unknown>;

export interface WorkerRunOptions {
  target: WorkerTarget;
  version: string;
  signal?: AbortSignal;
  onStatus?: (status: WorkerStatus) => void;
  handleRequest?: RequestHandler;
  /** What this computer can run. Defaults to probing its harness runtimes. */
  describe?: () => Promise<WorkerHarnessReport[]>;
  /** How each kind of command runs and recovers here. */
  handlers?: CommandHandlers;
  /** The journals, when a test supplies its own. Otherwise this computer's, under its work folder. */
  journals?: { commands: CommandJournal; events: EventJournal };
  /** Receives the sink this worker's runner reports to. The CLI installs it for the local runner. */
  onSink?: (sink: RunnerSink) => void;
  /** How often to retry posting events the home hasn't taken. */
  postRetryMs?: number;
  heartbeatMs?: number;
  backoffMinMs?: number;
  backoffMaxMs?: number;
  /** How long the stream may stay silent before it counts as dropped. */
  staleAfterMs?: number;
}

export class UnsupportedRequestError extends Error {
  constructor(kind: string) {
    super(`This computer doesn't know the request "${kind}". Update Ri here.`);
    this.name = 'UnsupportedRequestError';
  }
}

/** The requests every worker answers. */
export function defaultRequestHandler(
  describe: () => Promise<WorkerHarnessReport[]> = () => describeHarnesses({ refresh: true }),
): RequestHandler {
  return async (kind) => {
    switch (kind) {
      case 'describe_harnesses':
        return describe();
      default:
        throw new UnsupportedRequestError(kind);
    }
  };
}

function backoffDelay(attempt: number, minMs: number, maxMs: number): number {
  const base = Math.min(maxMs, minMs * 2 ** attempt);
  const jitter = base * 0.25 * (Math.random() * 2 - 1);
  return Math.max(minMs, Math.round(base + jitter));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export async function sendHeartbeat(
  target: WorkerTarget,
  version: string,
  state: WorkerHeartbeat['state'] = 'awake',
  describe: () => Promise<WorkerHarnessReport[]> = describeHarnesses,
): Promise<void> {
  const heartbeat: WorkerHeartbeat = { protocol: WORKER_PROTOCOL, version, harnesses: await describe(), state };
  const res = await workerFetch(target, '/api/workers/me/heartbeat', { method: 'POST', body: JSON.stringify(heartbeat) });
  if (!res.ok) throw new WorkerNetworkError(`${target.homeName} refused the heartbeat (HTTP ${res.status}).`);
}

async function answerRequest(
  target: WorkerTarget,
  event: Extract<WorkerStreamEvent, { type: 'request' }>,
  handle: RequestHandler,
): Promise<void> {
  let result: WorkerRequestResult;
  try {
    result = { ok: true, value: await handle(event.kind, event.payload) };
  } catch (err) {
    result = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ...(err instanceof UnsupportedRequestError ? { unsupported: true } : {}),
    };
  }
  await workerFetch(target, `/api/workers/me/requests/${encodeURIComponent(event.id)}/result`, {
    method: 'POST',
    body: JSON.stringify(result),
  });
}

export async function runWorker(options: WorkerRunOptions): Promise<WorkerExit> {
  const {
    target,
    version,
    signal,
    onStatus,
    describe = describeHarnesses,
    handleRequest = defaultRequestHandler(options.describe),
    heartbeatMs = WORKER_HEARTBEAT_MS,
    backoffMinMs = 1_000,
    backoffMaxMs = 30_000,
    staleAfterMs = WORKER_STREAM_PING_MS * 3,
    handlers = {},
    postRetryMs = 10_000,
  } = options;

  let exit: WorkerExit | null = null;
  const stop = (next: WorkerExit) => {
    exit ??= next;
    current?.abort();
  };
  let current: AbortController | null = null;

  // The journals: commands received and their outcomes, and everything this
  // computer's runner reports, both on disk before the home hears of them.
  const commandJournal = options.journals?.commands ?? new CommandJournal(target.homeId);
  const eventJournal = options.journals?.events ?? new EventJournal(target.homeId);
  const poster = new EventPoster(target, eventJournal);
  const processor = new CommandProcessor({
    journal: commandJournal,
    handlers,
    target,
    onStopped: (err) => stop({ reason: err.reason, message: err.message }),
  });
  options.onSink?.(createWorkerSink({ journal: eventJournal, onAppend: () => void poster.kick() }));
  void processor.recoverAll();
  const postRetry = setInterval(() => {
    if (eventJournal.pending(1).length > 0) void poster.kick();
  }, postRetryMs);
  postRetry.unref?.();

  // Heartbeats run on their own clock, connected or not: a missed one while
  // reconnecting is just a gap in last contact.
  const beat = () => {
    void sendHeartbeat(target, version, 'awake', describe).catch((err: unknown) => {
      if (err instanceof WorkerStoppedError) stop({ reason: err.reason, message: err.message });
    });
  };
  const heartbeat = setInterval(beat, heartbeatMs);
  heartbeat.unref?.();

  let attempt = 0;
  try {
    while (!exit && !signal?.aborted) {
      onStatus?.({ state: 'connecting', attempt });
      current = new AbortController();
      const connection = signal ? AbortSignal.any([signal, current.signal]) : current.signal;
      let lastEventAt = Date.now();
      const watchdog = setInterval(() => {
        if (Date.now() - lastEventAt > staleAfterMs) current?.abort();
      }, Math.min(staleAfterMs, 5_000));
      watchdog.unref?.();
      let error = 'The connection closed.';
      try {
        const res = await workerFetch(target, `/api/workers/me/stream?after=${commandJournal.cursor()}`, {
          signal: connection,
          timeoutMs: null,
          headers: { accept: 'text/event-stream' },
        });
        if (!res.ok || !res.body) throw new WorkerNetworkError(`${target.homeName} answered with HTTP ${res.status}.`);
        for await (const frame of readEventStream(res.body)) {
          lastEventAt = Date.now();
          const event = JSON.parse(frame.data) as WorkerStreamEvent;
          if (event.type === 'hello') {
            if (event.homeId !== target.homeId) {
              stop({
                reason: 'wrong_home',
                message: `${target.homeUrl} now answers for a different Ri. Connect this computer again.`,
              });
              break;
            }
            attempt = 0;
            // A journal that was cleared numbers on after what the home holds.
            eventJournal.rebase(event.ackedEventSeq);
            onStatus?.({ state: 'connected' });
            beat();
            void poster.kick();
            void processor.resendAcks();
          } else if (event.type === 'command') {
            processor.receive(event.command);
          } else if (event.type === 'request') {
            void answerRequest(target, event, handleRequest).catch(() => {
              // The home stopped waiting, or the connection dropped. Nothing to undo.
            });
          } else if (event.type === 'revoked') {
            stop({ reason: 'revoked', message: event.message });
            break;
          }
        }
      } catch (err) {
        if (err instanceof WorkerStoppedError) stop({ reason: err.reason, message: err.message });
        else error = err instanceof Error ? err.message : String(err);
      } finally {
        clearInterval(watchdog);
      }
      if (exit || signal?.aborted) break;
      const retryInMs = backoffDelay(attempt++, backoffMinMs, backoffMaxMs);
      onStatus?.({ state: 'disconnected', error, retryInMs });
      await sleep(retryInMs, signal);
    }
  } finally {
    clearInterval(heartbeat);
    clearInterval(postRetry);
  }
  return exit ?? { reason: 'stopped' };
}
