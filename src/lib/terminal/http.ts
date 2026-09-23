/**
 * HTTP handlers for the in-app terminal, shared by every surface that owns
 * shells:
 *
 *   - executions: `/api/sessions/:id/terminals/*`, owned by the execution
 *     (`terminalOwnerId`), rooted in its worktree
 *   - agents: `/api/workspaces/:id/terminals/*`, owned by the workspace
 *     (`workspaceTerminalOwnerId`), rooted in the agent's own folder
 *
 * Each route resolves the owner (and, to create, the cwd). These do the
 * rest, so both surfaces answer with identical shapes and the terminal panel
 * only swaps its base URL.
 *
 * Deliberately free of `next/server` so the handlers stay plain functions of
 * a `Request`.
 */

import {
  createTerminal,
  getTerminal,
  killTerminal,
  listTerminals,
  resizeTerminal,
  subscribe,
  TerminalSpawnError,
  writeInput,
} from './pty-manager';
import type { TerminalCwd, TerminalOwner } from './owner';

function refuse(resolved: { error: string; status: number }): Response {
  return Response.json({ error: resolved.error }, { status: resolved.status });
}

export function listTerminalsResponse(owner: TerminalOwner): Response {
  if (!owner.ok) return refuse(owner);
  return Response.json(listTerminals(owner.ownerId));
}

export async function createTerminalResponse(
  request: Request,
  resolved: TerminalCwd,
  logTag: string,
): Promise<Response> {
  if (!resolved.ok) return refuse(resolved);

  const body = (await request.json().catch(() => ({}))) as { cols?: number; rows?: number };
  const cols = Number.isFinite(body.cols) && body.cols! > 0 ? Math.floor(body.cols!) : 80;
  const rows = Number.isFinite(body.rows) && body.rows! > 0 ? Math.floor(body.rows!) : 24;

  try {
    const descriptor = createTerminal({ ownerId: resolved.ownerId, cwd: resolved.cwd, cols, rows });
    return Response.json(descriptor, { status: 201 });
  } catch (err) {
    // Check by name, not `instanceof` — Next.js HMR can re-evaluate
    // the manager module so the class identity differs between the
    // route's import and the throw site, and `instanceof` returns
    // false. The name is stable across module copies.
    const isSpawnError =
      err instanceof Error &&
      (err.name === 'TerminalSpawnError' || err instanceof TerminalSpawnError);
    if (isSpawnError) {
      const code = (err as TerminalSpawnError).code ?? 'spawn_failed';
      const status = code === 'spawn_failed' ? 500 : 409;
      console.error(`${logTag} spawn failed:`, err.message);
      return Response.json({ error: err.message, code }, { status });
    }
    // Unknown failure — log + surface the message instead of letting
    // the outer catch flatten it to "[object Object]" via String().
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${logTag} unexpected:`, err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export function getTerminalResponse(owner: TerminalOwner, terminalId: string): Response {
  if (!owner.ok) return refuse(owner);
  const t = getTerminal(owner.ownerId, terminalId);
  if (!t) return Response.json({ error: 'Terminal not found' }, { status: 404 });
  return Response.json(t);
}

export function deleteTerminalResponse(owner: TerminalOwner, terminalId: string): Response {
  if (!owner.ok) return refuse(owner);
  const ok = killTerminal(owner.ownerId, terminalId);
  if (!ok) return Response.json({ error: 'Terminal not found' }, { status: 404 });
  return Response.json({ ok: true });
}

/**
 * Forward keystrokes. `onInput` runs after a successful write (the execution
 * surface uses it to bump the rail's activity sort key).
 */
export async function terminalInputResponse(
  request: Request,
  owner: TerminalOwner,
  terminalId: string,
  onInput?: () => void,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { data?: unknown } | null;
  if (!body || typeof body.data !== 'string') {
    return Response.json({ error: 'data must be a string' }, { status: 400 });
  }
  if (!owner.ok) return refuse(owner);
  const ok = writeInput(owner.ownerId, terminalId, body.data);
  if (!ok) return Response.json({ error: 'Terminal not found or exited' }, { status: 404 });
  onInput?.();
  return Response.json({ ok: true });
}

export async function terminalResizeResponse(
  request: Request,
  owner: TerminalOwner,
  terminalId: string,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { cols?: number; rows?: number } | null;
  if (
    !body ||
    !Number.isFinite(body.cols) ||
    !Number.isFinite(body.rows) ||
    body.cols! < 1 ||
    body.rows! < 1
  ) {
    return Response.json({ error: 'cols and rows must be positive numbers' }, { status: 400 });
  }
  if (!owner.ok) return refuse(owner);
  const ok = resizeTerminal(owner.ownerId, terminalId, Math.floor(body.cols!), Math.floor(body.rows!));
  if (!ok) return Response.json({ error: 'Terminal not found or exited' }, { status: 404 });
  return Response.json({ ok: true });
}

const encoder = new TextEncoder();

function sse(event: string, data: unknown, id?: number): Uint8Array {
  // SSE message — `event:` is optional but lets the client target a
  // specific listener. Multi-line data has to use repeated `data:`
  // prefixes; we sidestep that by JSON-encoding once so the payload
  // is always a single line.
  //
  // `id:` is what makes reconnects resumable. The browser stores the last
  // one it saw and replays it as `Last-Event-ID` on the next connect,
  // with no client-side bookkeeping needed.
  const idLine = id === undefined ? '' : `id: ${id}\n`;
  const payload = `${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  return encoder.encode(payload);
}

/** Resume cursor from a reconnecting `EventSource`, if it sent one. */
function parseLastEventId(request: Request): number | undefined {
  const raw = request.headers.get('last-event-id');
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Server-Sent Events stream of a terminal's stdout.
 *
 * On connect the server replays the recent buffer (so refreshes don't
 * lose context), then streams live chunks. Cookie auth is what makes
 * `EventSource` work here — it can't attach an Authorization header.
 *
 * `resolveOwner` runs inside the stream's start, so an unknown owner is
 * reported as an SSE `error` event (what `EventSource` can read) rather
 * than an HTTP status it can't.
 */
export function terminalStreamResponse(
  request: Request,
  resolveOwner: () => TerminalOwner,
  terminalId: string,
): Response {
  const since = parseLastEventId(request);

  let unsubscribe: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (chunk: Uint8Array) => {
        try { controller.enqueue(chunk); } catch { /* closed */ }
      };

      const owner = resolveOwner();
      if (!owner.ok) {
        enqueue(sse('error', { message: owner.error }));
        try { controller.close(); } catch { /* */ }
        return;
      }

      const result = subscribe(owner.ownerId, terminalId, (chunk) => {
        if (chunk.type === 'data') {
          enqueue(sse('data', chunk.data, chunk.offset));
        } else {
          enqueue(sse('exit', { code: chunk.code, signal: chunk.signal }));
          try { controller.close(); } catch { /* */ }
        }
      }, since);

      if (!result) {
        enqueue(sse('error', { message: 'Terminal not found' }));
        try { controller.close(); } catch { /* */ }
        return;
      }
      unsubscribe = result.unsubscribe;

      // `resumed` tells the client this is a continuation, not a fresh
      // view, so it doesn't clear a screen it's about to be handed the
      // tail of. `gap` is the exception: output was evicted while we were
      // away, so the replay can't be spliced on cleanly.
      enqueue(sse('ready', { id: terminalId, resumed: since !== undefined && !result.gap }));
      if (result.replay) enqueue(sse('data', result.replay, result.offset));
      if (result.exited) {
        enqueue(sse('exit', { code: result.exitCode, signal: null }));
        try { controller.close(); } catch { /* */ }
        return;
      }

      // Idle keep-alive: comment lines are ignored by EventSource but keep
      // proxies/load-balancers from severing an "idle" connection. 25s
      // because most timeouts kick in around 30–60s.
      keepAlive = setInterval(() => {
        enqueue(encoder.encode(`: ping\n\n`));
      }, 25_000);
    },
    cancel() {
      if (unsubscribe) unsubscribe();
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
