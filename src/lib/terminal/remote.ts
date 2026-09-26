/**
 * Terminals on a connected computer, seen from the home (docs/homes-build.md,
 * P3.5, spec §5.6). The shell runs there, under that computer's worker. The
 * home forwards each operation as a `terminal` request and relays output the
 * worker posts to whoever is watching, with the same stream the home's own
 * terminals give: `ready`, `data` with its offset as the event id, `exit`.
 *
 * A viewer catches up from the worker's own ring buffer, never from a copy
 * here, so there's one record of what a shell printed. Output that arrives
 * out of step with what a viewer has (a batch the worker had to drop, or
 * trimmed) ends that viewer's stream, and its reconnect catches it up.
 *
 * When the computer isn't connected the stream says so (`unavailable`) and
 * closes, and the browser keeps trying. Nothing here ever starts a shell at
 * home in its place.
 */

import { requestWorker, WorkerRequestError, WorkerUnavailableError } from '@/lib/workers/hub';
import type { TerminalOutputBatch, TerminalRequest, TerminalScope } from '@/lib/workers/protocol';
import type { ReadAnswer } from '@/lib/workspaces/execution-reads';

/** Where a remote terminal lives: the computer, by id and name, and whose shells. */
export interface RemoteTerminalPlace {
  computerId: string;
  computerName: string;
  scope: TerminalScope;
}

interface Watcher {
  computerId: string;
  onChunk: (chunk: { data: string; offset: number }) => void;
  onExit: (exit: { code: number | null; signal: number | null }) => void;
  onGone: (message: string) => void;
}

interface WatchState {
  watchers: Map<string, Set<Watcher>>;
}

// On globalThis so every route bundle shares one set of watchers.
const KEY = Symbol.for('@ri/remote-terminal-watchers');
const g = globalThis as unknown as { [KEY]?: WatchState };
g[KEY] ??= { watchers: new Map() };
const state = g[KEY]!;

function watch(terminalId: string, watcher: Watcher): () => void {
  const set = state.watchers.get(terminalId) ?? new Set();
  set.add(watcher);
  state.watchers.set(terminalId, set);
  return () => {
    set.delete(watcher);
    if (set.size === 0) state.watchers.delete(terminalId);
  };
}

/**
 * Output a worker posted. Only reaches viewers watching that terminal on
 * that computer: a worker can't write into another computer's terminal.
 */
export function deliverTerminalOutput(computerId: string, batch: TerminalOutputBatch): void {
  for (const chunk of batch.chunks ?? []) {
    for (const w of state.watchers.get(chunk.terminalId) ?? []) {
      if (w.computerId === computerId) w.onChunk({ data: chunk.data, offset: chunk.offset });
    }
  }
  for (const exit of batch.exits ?? []) {
    for (const w of state.watchers.get(exit.terminalId) ?? []) {
      if (w.computerId === computerId) w.onExit({ code: exit.code, signal: exit.signal });
    }
  }
}

/** The computer dropped: every stream showing its terminals says so and closes. */
export function computerTerminalsGone(computerId: string, computerName: string): void {
  for (const set of state.watchers.values()) {
    for (const w of [...set]) {
      if (w.computerId === computerId) w.onGone(unavailableMessage(computerName));
    }
  }
}

export function unavailableMessage(computerName: string): string {
  return `${computerName} isn't connected. Its terminals are still there and come back when it reconnects.`;
}

/** One operation on the computer's terminals, as `{ status, body }`. */
export async function askTerminal(place: RemoteTerminalPlace, request: TerminalRequest): Promise<ReadAnswer> {
  try {
    return (await requestWorker(place.computerId, 'terminal', request)) as ReadAnswer;
  } catch (err) {
    if (err instanceof WorkerUnavailableError) {
      return { status: 409, body: { error: 'unavailable', message: unavailableMessage(place.computerName) } };
    }
    if (err instanceof WorkerRequestError) {
      const message = err.unsupported
        ? `${place.computerName} runs an older Ri without terminals from here. Update Ri there.`
        : `${place.computerName} didn't answer: ${err.message}`;
      // Not a 5xx: clients read gateway statuses as the home being unreachable.
      return { status: 424, body: { error: 'unconfirmed', message } };
    }
    throw err;
  }
}

const encoder = new TextEncoder();

function sse(event: string, data: unknown, id?: number): Uint8Array {
  const idLine = id === undefined ? '' : `id: ${id}\n`;
  return encoder.encode(`${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function lastEventId(request: Request): number | undefined {
  const raw = request.headers.get('last-event-id');
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** How soon a browser tries again after a stream this closes (unavailable, or out of step). */
const RETRY_MS = 2_000;

interface Replay {
  replay: string;
  offset: number;
  gap: boolean;
  exited: boolean;
  exitCode: number | null;
}

/**
 * The output stream of a terminal on another computer. Starts watching
 * before asking for the replay, so nothing printed in between is lost, then
 * splices live output on by offset.
 */
export function remoteTerminalStream(request: Request, place: RemoteTerminalPlace, terminalId: string): Response {
  const since = lastEventId(request);
  let stopWatching: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try { controller.enqueue(chunk); } catch { /* closed */ }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        stopWatching?.();
        if (keepAlive) clearInterval(keepAlive);
        try { controller.close(); } catch { /* */ }
      };
      enqueue(encoder.encode(`retry: ${RETRY_MS}\n\n`));

      // Where the viewer is: -1 until the replay says, while early output waits.
      let at = -1;
      const early: Array<{ data: string; offset: number }> = [];
      let exited: { code: number | null; signal: number | null } | null = null;

      const send = (chunk: { data: string; offset: number }) => {
        const start = chunk.offset - chunk.data.length;
        if (chunk.offset <= at) return; // already seen
        if (start > at) {
          // Output the viewer never got: end this stream, and its reconnect
          // catches up from the computer's ring.
          close();
          return;
        }
        enqueue(sse('data', chunk.data.slice(at - start), chunk.offset));
        at = chunk.offset;
      };

      stopWatching = watch(terminalId, {
        computerId: place.computerId,
        onChunk: (chunk) => (at < 0 ? early.push(chunk) : send(chunk)),
        onExit: (exit) => {
          if (at < 0) {
            exited = exit;
            return;
          }
          enqueue(sse('exit', exit));
          close();
        },
        onGone: (message) => {
          enqueue(sse('unavailable', { message }));
          close();
        },
      });

      const answer = await askTerminal(place, { op: 'replay', scope: place.scope, terminalId, since });
      if (closed) return;
      if (answer.status === 404) {
        // The shell is gone there (its computer restarted, or it was closed).
        enqueue(sse('exit', { code: null, signal: null, gone: true }));
        close();
        return;
      }
      if (answer.status !== 200) {
        const body = answer.body as { message?: string; error?: string } | null;
        enqueue(sse('unavailable', { message: body?.message ?? body?.error ?? unavailableMessage(place.computerName) }));
        close();
        return;
      }
      const replay = answer.body as Replay;
      enqueue(sse('ready', { id: terminalId, resumed: since !== undefined && !replay.gap }));
      if (replay.replay) enqueue(sse('data', replay.replay, replay.offset));
      at = replay.offset;
      if (replay.exited || exited) {
        enqueue(sse('exit', exited ?? { code: replay.exitCode, signal: null }));
        close();
        return;
      }
      for (const chunk of early.splice(0)) {
        send(chunk);
        if (closed) return;
      }
      keepAlive = setInterval(() => enqueue(encoder.encode(': ping\n\n')), 25_000);
    },
    cancel() {
      closed = true;
      stopWatching?.();
      if (keepAlive) clearInterval(keepAlive);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

/** Test helper. */
export function _resetRemoteTerminals(): void {
  state.watchers.clear();
}
