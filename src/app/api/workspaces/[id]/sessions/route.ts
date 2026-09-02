import type { NextRequest } from 'next/server';
import { listWorkspaceExecutions, getWorkspace } from '@/lib/db/queries';
import type { EffortLevel } from '@/db/types';
import { dispatchExecutionSession, WorkspaceNotFoundForDispatch, TaskNotStartableForDispatch } from '@/lib/sessions/dispatch';
import { withCompression } from '@/lib/api/compression';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    // One row per execution (its primary chat), not per chat — the tree
    // collapses an execution's sibling chats into a single named row.
    // `includeArchived` is the launcher's "Show archived" digging deeper into
    // finished work; the rail never asks for it.
    const includeArchived = request.nextUrl.searchParams.get('includeArchived') === 'true';
    const rows = listWorkspaceExecutions(id, { includeArchived });
    return Response.json(rows);
  } catch (err) {
    console.error('[GET /api/workspaces/:id/sessions]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: {
      sessionId?: string;
      label?: string;
      harness?: string;
      model?: string | null;
      modelVariant?: string | null;
      effort?: EffortLevel | null;
      baseBranch?: string;
      prNumber?: number | null;
      liveMode?: boolean;
      taskId?: string | null;
    } = await request.json().catch(() => ({}));
    if (!getWorkspace(id)) {
      return Response.json({ error: 'Workspace not found' }, { status: 404 });
    }
    // Label is optional. Empty/missing → null on the row; the first user
    // message will derive a real label (see /api/sessions/[id]/messages).
    // baseBranch overrides the workspace default — set by the launcher's
    // `base` chip when it came from a branch pick.
    // prNumber wins over baseBranch — set by a PR pick. Server resolves
    // the head via `refs/pull/<N>/head`, which works for forks and PRs
    // the user has never checked out locally.
    // liveMode skips worktree creation entirely — agent runs in the
    // workspace's actual folder on whatever branch is checked out.
    // harness/model/variant/effort come from the launcher's model
    // control; omitted, they fall back to the saved global default.
    // A supplied id becomes a branch name and a worktree path, so it has to
    // be exactly a UUID and nothing else. Reject rather than quietly minting a
    // replacement: the caller sends this precisely because it has already
    // navigated to that id, and a silent substitution would strand it there.
    if (body.sessionId !== undefined && !UUID_RE.test(body.sessionId ?? '')) {
      return Response.json({ error: 'sessionId must be a UUID' }, { status: 400 });
    }
    const row = await dispatchExecutionSession({
      workspaceId: id,
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : null,
      label: body.label?.trim() || null,
      harness: body.harness,
      model: body.model ?? null,
      modelVariant: body.modelVariant ?? null,
      effort: body.effort ?? null,
      baseBranch: body.baseBranch?.trim() || null,
      prNumber: typeof body.prNumber === 'number' ? body.prNumber : null,
      liveMode: !!body.liveMode,
      taskId: typeof body.taskId === 'string' ? body.taskId : null,
    });
    return Response.json(row, { status: 201 });
  } catch (err) {
    if (err instanceof WorkspaceNotFoundForDispatch) {
      return Response.json({ error: 'Workspace not found' }, { status: 404 });
    }
    if (err instanceof TaskNotStartableForDispatch) {
      return Response.json(
        { error: err.name, message: err.message },
        { status: err.taskStatus === 'not_found' ? 404 : 409 },
      );
    }
    // Surface library error names so the client can branch on them.
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/workspaces/:id/sessions]', err);
    return Response.json({ error: name, message }, { status: 500 });
  }
}
