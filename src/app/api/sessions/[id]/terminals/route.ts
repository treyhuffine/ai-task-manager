import type { NextRequest } from 'next/server';
import * as fs from 'node:fs';
import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { createTerminal, listTerminals, TerminalSpawnError } from '@/lib/terminal/pty-manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ResolvedCwd =
  | { ok: true; cwd: string }
  | { ok: false; error: string; status: number };

/** Does this path resolve to an existing directory on disk? */
function isExistingDir(p: string | null | undefined): p is string {
  if (!p) return false;
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Pick a usable cwd for the terminal. The worktree path wins when it
 * actually exists on disk; otherwise we fall back to the workspace cwd.
 * This matters because a session row can outlive its worktree (manual
 * cleanup, archived worktrees, dev resets) — without the existence
 * check, node-pty raises `posix_spawnp failed` on a stale path.
 */
function resolveCwd(sessionId: string): ResolvedCwd {
  const session = getChatSessionWithExecution(sessionId);
  if (!session) return { ok: false, error: 'Session not found', status: 404 };

  if (isExistingDir(session.worktree_path)) {
    return { ok: true, cwd: session.worktree_path };
  }

  if (session.workspace_id) {
    const ws = getWorkspace(session.workspace_id);
    if (isExistingDir(ws?.cwd)) {
      return { ok: true, cwd: ws.cwd };
    }
  }

  // Both candidates missing — be specific about which so the user
  // can fix it. Worktree set but missing is the common case (session
  // archived or its worktree was pruned).
  if (session.worktree_path) {
    return {
      ok: false,
      error: `Worktree directory does not exist: ${session.worktree_path}`,
      status: 409,
    };
  }

  return {
    ok: false,
    error: 'No worktree or workspace cwd for this session',
    status: 409,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getChatSessionWithExecution(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    return Response.json(listTerminals(id));
  } catch (err) {
    console.error('[GET /api/sessions/:id/terminals]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

interface CreateBody {
  cols?: number;
  rows?: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const resolved = resolveCwd(id);
    if (!resolved.ok) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }

    const body = (await request.json().catch(() => ({}))) as CreateBody;
    const cols = Number.isFinite(body.cols) && body.cols! > 0 ? Math.floor(body.cols!) : 80;
    const rows = Number.isFinite(body.rows) && body.rows! > 0 ? Math.floor(body.rows!) : 24;

    let descriptor;
    try {
      descriptor = createTerminal({
        sessionId: id,
        cwd: resolved.cwd,
        cols,
        rows,
      });
    } catch (err) {
      // Check by name, not `instanceof` — Next.js HMR can re-evaluate
      // the manager module so the class identity differs between the
      // route's import and the throw site, and `instanceof` returns
      // false. The name is stable across module copies.
      const isSpawnError =
        err instanceof Error &&
        (err.name === 'TerminalSpawnError' ||
          err instanceof TerminalSpawnError);
      if (isSpawnError) {
        const code = (err as TerminalSpawnError).code ?? 'spawn_failed';
        const status = code === 'spawn_failed' ? 500 : 409;
        console.error('[POST /api/sessions/:id/terminals] spawn failed:', err.message);
        return Response.json({ error: err.message, code }, { status });
      }
      // Unknown failure — log + surface the message instead of letting
      // the outer catch flatten it to "[object Object]" via String().
      const message = err instanceof Error ? err.message : String(err);
      console.error('[POST /api/sessions/:id/terminals] unexpected:', err);
      return Response.json({ error: message }, { status: 500 });
    }

    return Response.json(descriptor, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/sessions/:id/terminals]', err);
    return Response.json({ error: message }, { status: 500 });
  }
}
