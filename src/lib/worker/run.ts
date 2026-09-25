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
 * Nothing a command does happens before the home has accepted this worker:
 * after a restart, the commands a crash interrupted are recovered only once
 * the first stream is open (the key is good, the protocol and the home are
 * right) and a heartbeat has confirmed which placements are still this
 * computer's. A turn the restart cut off is reported as failed, never sent
 * again (docs/homes-build.md, P2 review fixes).
 *
 * Runs on the connected computer, so it never touches a database.
 */

import { uuidv7 } from 'uuidv7';
import type { WorkerHarnessReport } from '@/db/types';
import { runnerState } from '@/lib/runner/live-state';
import { close as closeSession } from '@/lib/runner/local-runner';
import { listForSession, listSessionsWithPending } from '@/lib/runner/pending';
import {
  WORKER_HEARTBEAT_MS,
  WORKER_PROTOCOL,
  WORKER_STREAM_PING_MS,
  type WorkerHeartbeat,
  type WorkerHeartbeatReply,
  type WorkerLive,
  type WorkerPlacementReport,
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
  /** Makes the handler for the home's reads, given this worker's command journal. Tried before the built-in ones. */
  requests?: (journal: CommandJournal) => RequestHandler;
  /** What this computer can run. Defaults to probing its harness runtimes. */
  describe?: () => Promise<WorkerHarnessReport[]>;
  /** How each kind of command runs and recovers here, given this worker's command journal. */
  handlers?: CommandHandlers | ((journal: CommandJournal) => CommandHandlers);
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

/** What this computer's runner has live, for the home's mirror. */
export function liveSnapshot(): WorkerLive {
  return {
    running: [...runnerState.runningSessions],
    pending: listSessionsWithPending().flatMap((id) => listForSession(id)),
    backgroundTasks: Object.fromEntries([...runnerState.backgroundTasks].map(([chat, ids]) => [chat, [...ids]])),
  };
}

export async function sendHeartbeat(
  target: WorkerTarget,
  version: string,
  state: WorkerHeartbeat['state'] = 'awake',
  describe: () => Promise<WorkerHarnessReport[]> = describeHarnesses,
  extras: { live?: WorkerLive; placements?: WorkerPlacementReport[] } = {},
): Promise<WorkerHeartbeatReply | null> {
  const heartbeat: WorkerHeartbeat = { protocol: WORKER_PROTOCOL, version, harnesses: await describe(), state, ...extras };
  const res = await workerFetch(target, '/api/workers/me/heartbeat', { method: 'POST', body: JSON.stringify(heartbeat) });
  if (!res.ok) throw new WorkerNetworkError(`${target.homeName} refused the heartbeat (HTTP ${res.status}).`);
  const reply = (await res.json().catch(() => null)) as WorkerHeartbeatReply | null;
  return reply?.ok ? reply : null;
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
    heartbeatMs = WORKER_HEARTBEAT_MS,
    backoffMinMs = 1_000,
    backoffMaxMs = 30_000,
    staleAfterMs = WORKER_STREAM_PING_MS * 3,
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
  const handlers = typeof options.handlers === 'function' ? options.handlers(commandJournal) : options.handlers ?? {};
  const builtIn = defaultRequestHandler(options.describe);
  const extra = options.requests?.(commandJournal);
  // Each read goes to the one that knows it: the supplied handler first, then the built-in ones.
  const handleRequest: RequestHandler = async (kind, payload) => {
    if (extra) {
      try {
        return await extra(kind, payload);
      } catch (err) {
        if (!(err instanceof UnsupportedRequestError)) throw err;
      }
    }
    return builtIn(kind, payload);
  };
  const poster = new EventPoster(target, eventJournal);
  const processor = new CommandProcessor({
    journal: commandJournal,
    handlers,
    target,
    onStopped: (err) => stop({ reason: err.reason, message: err.message }),
  });
  options.onSink?.(
    createWorkerSink({
      journal: eventJournal,
      generationOf: (chat) => commandJournal.chatGeneration(chat),
      runOf: (chat) => commandJournal.openTurnOf(chat)?.runId ?? null,
      onTurnEnded: (turnId) => commandJournal.turnEnded(turnId),
      onAppend: () => void poster.kick(),
    }),
  );
  // Turns an earlier run of this worker delivered and never finished. The
  // process running them is gone. Taken before anything here can deliver.
  const cutOff = commandJournal.openTurns();
  const postRetry = setInterval(() => {
    if (eventJournal.pending(1).length > 0) void poster.kick();
  }, postRetryMs);
  postRetry.unref?.();

  // Heartbeats run on their own clock, connected or not: a missed one while
  // reconnecting is just a gap in last contact. Each carries what's live, with
  // each chat's generation, and the placements held. A placement the home no
  // longer gives this computer is fenced in the journal, so nothing older for
  // it runs even after a restart, and then its sessions stop.
  const heartbeat = async () => {
    const live = liveSnapshot();
    const chats = new Set([...live.running, ...live.pending.map((p) => p.sessionId), ...Object.keys(live.backgroundTasks)]);
    live.generations = Object.fromEntries([...chats].map((chat) => [chat, commandJournal.chatGeneration(chat)]));
    const reply = await sendHeartbeat(target, version, 'awake', describe, { live, placements: commandJournal.placements() });
    for (const released of reply?.release ?? []) {
      commandJournal.release(released.executionId, released.generation);
      for (const chat of released.chatSessionIds) await closeSession(chat).catch(() => {});
    }
  };
  const beat = () => {
    void heartbeat().catch((err: unknown) => {
      if (err instanceof WorkerStoppedError) stop({ reason: err.reason, message: err.message });
    });
  };

  // Once, on the first stream the home accepts: ownership, then recovery,
  // then turns cut off. A failure leaves it for the next connection.
  let recovered = false;
  const recover = async () => {
    await heartbeat();
    await processor.recoverAll();
    // Recovery can find a send in the native history: delivered before the
    // restart, and its turn cut off by it too.
    const found = commandJournal.openTurns().filter((t) => t.reconciled && !cutOff.some((c) => c.turnId === t.turnId));
    for (const turn of [...cutOff, ...found]) {
      eventJournal.append({
        kind: 'signal',
        eventId: uuidv7(),
        chatSessionId: turn.chatSessionId,
        // The placement that ran the turn, which the home checks its run against.
        generation: turn.generation,
        occurredAt: new Date().toISOString(),
        signal: {
          type: 'turn_result',
          turnId: turn.turnId,
          runId: turn.runId,
          ok: false,
          error: `The turn stopped when Ri's worker on ${target.computerName} restarted.`,
        },
      });
      commandJournal.turnEnded(turn.turnId);
    }
    void poster.kick();
    recovered = true;
  };
  const heartbeatTimer = setInterval(beat, heartbeatMs);
  heartbeatTimer.unref?.();

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
            // Commands wait on the stream until this is done.
            if (!recovered) {
              await recover();
              lastEventAt = Date.now();
            } else {
              beat();
            }
            onStatus?.({ state: 'connected' });
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
    clearInterval(heartbeatTimer);
    clearInterval(postRetry);
  }
  return exit ?? { reason: 'stopped' };
}
