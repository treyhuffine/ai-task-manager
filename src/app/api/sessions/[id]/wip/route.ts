import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import {
  detectSourceWip,
  copyWipToWorktree,
  moveWipToWorktree,
} from '@/lib/workspaces/wip';

/**
 * Live WIP read for the session's source repo. Returns the current
 * state — counts may differ from when the worktree was provisioned if
 * the user has kept editing in the source repo since. That's intentional:
 * the banner asks about *what's there now*, not what was there at create
 * time.
 *
 * Returns `null` for non-git workspaces or sessions whose worktree
 * hasn't been provisioned yet — the banner sits dormant in those cases.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getChatSessionWithExecution(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (!session.worktreePath || !session.workspaceId) {
      return Response.json(null);
    }
    const ws = getWorkspace(session.workspaceId);
    if (!ws || !ws.isGit) return Response.json(null);

    const wip = await detectSourceWip(ws.cwd, ws.filesToCopy ?? []);
    return Response.json(wip);
  } catch (err) {
    console.error('[GET /api/sessions/:id/wip]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

interface PostBody {
  action: 'copy' | 'move';
}

/**
 * Apply a WIP handoff. Re-detects the source repo's current WIP — we
 * don't trust a client-supplied file list because the source could have
 * changed since the banner rendered. Then copies or stashes+pops.
 *
 * Response shapes:
 *   - copy:  { action: 'copy', copied: string[], skipped: {...}[] }
 *   - move:  { action: 'move', conflict: boolean, stashMessage: string | null }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as PostBody;
    if (body.action !== 'copy' && body.action !== 'move') {
      return Response.json(
        { error: `Invalid action. Expected 'copy' or 'move'.` },
        { status: 400 },
      );
    }

    const session = getChatSessionWithExecution(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (!session.worktreePath || !session.workspaceId) {
      return Response.json({ error: 'Worktree not provisioned yet' }, { status: 409 });
    }
    const ws = getWorkspace(session.workspaceId);
    if (!ws || !ws.isGit) {
      return Response.json({ error: 'Workspace is not a git workspace' }, { status: 409 });
    }

    const wip = await detectSourceWip(ws.cwd, ws.filesToCopy ?? []);
    const allFiles = [...wip.modified, ...wip.untracked];
    if (allFiles.length === 0) {
      return Response.json({ action: body.action, empty: true });
    }

    if (body.action === 'copy') {
      const result = await copyWipToWorktree({
        sourceCwd: ws.cwd,
        worktreePath: session.worktreePath,
        files: allFiles,
      });
      return Response.json({ action: 'copy', ...result });
    }

    const result = await moveWipToWorktree({
      sourceCwd: ws.cwd,
      worktreePath: session.worktreePath,
      files: allFiles,
    });
    return Response.json({ action: 'move', ...result });
  } catch (err) {
    console.error('[POST /api/sessions/:id/wip]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
