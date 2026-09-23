import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { isExistingDir, sessionTerminalOwner, terminalOwnerId, type TerminalCwd } from '@/lib/terminal/owner';
import { createTerminalResponse, listTerminalsResponse } from '@/lib/terminal/http';
import { withCompression } from '@/lib/api/compression';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Pick a usable cwd for the terminal.
 *
 * The worktree path wins when it actually exists on disk — this also
 * covers live mode, where `worktreePath === ws.cwd`.
 *
 * The important rule: a git workspace runs every session inside an
 * isolated worktree, so when that worktree isn't resolvable we must NOT
 * silently drop the terminal into the workspace's main checkout. Doing so
 * is exactly the "terminal opened in the main repo instead of the
 * worktree" bug — and worse, the spawned PTY's cwd is frozen for the life
 * of the terminal, so the mistake sticks even after the worktree appears.
 * We surface a 409 instead so the panel can show "setting up / worktree
 * missing" rather than handing the user a shell in the wrong tree.
 *
 * The workspace-cwd fallback only applies to non-git workspaces, where
 * there is no worktree and the agent legitimately runs in `ws.cwd`.
 */
function resolveCwd(sessionId: string): TerminalCwd {
  const session = getChatSessionWithExecution(sessionId);
  if (!session) return { ok: false, error: 'Session not found', status: 404 };

  const ownerId = terminalOwnerId(session);

  if (isExistingDir(session.worktreePath)) {
    return { ok: true, cwd: session.worktreePath, ownerId };
  }

  const ws = session.workspaceId ? getWorkspace(session.workspaceId) : undefined;

  // Git workspace: the worktree is the only valid cwd. Be specific about
  // why it's not usable yet so the client can distinguish "still
  // provisioning" from "the worktree was pruned/archived".
  if (ws?.isGit) {
    if (session.worktreePath) {
      return {
        ok: false,
        error: `Worktree directory does not exist: ${session.worktreePath}`,
        status: 409,
      };
    }
    return {
      ok: false,
      error: 'Worktree is still being set up for this session',
      status: 409,
    };
  }

  // Non-git workspace: no worktree concept — the agent runs in ws.cwd.
  if (isExistingDir(ws?.cwd)) {
    return { ok: true, cwd: ws.cwd, ownerId };
  }

  return {
    ok: false,
    error: 'No worktree or workspace cwd for this session',
    status: 409,
  };
}

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    // Terminals belong to the execution, so every chat under it lists the
    // same shells — that's what keeps your terminal alive across a chat
    // switch instead of stranding it.
    return listTerminalsResponse(sessionTerminalOwner(id));
  } catch (err) {
    console.error('[GET /api/sessions/:id/terminals]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return await createTerminalResponse(request, resolveCwd(id), '[POST /api/sessions/:id/terminals]');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/sessions/:id/terminals]', err);
    return Response.json({ error: message }, { status: 500 });
  }
}
