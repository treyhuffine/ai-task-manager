import type { NextRequest } from 'next/server';
import { continueExecutionSession } from '@/lib/sessions/dispatch';

/**
 * Resume an archived execution AND re-provision its worktree from a fresh
 * base. The DB row flips back to `active`, the stale `worktreePath` is
 * nulled, and a new worktree is created in the background off
 * `body.baseBranch ?? ws.baseBranch`.
 *
 * Returns the (post-unarchive, pre-provision) row immediately — the UI's
 * existing "setting up..." state handles the wait until the new
 * worktreePath / branchName / baseSha land on the execution.
 *
 * Body: { baseBranch?: string | null } — when omitted, defaults to the
 * workspace's base branch (typically `main`), which is the right behavior
 * for "PR was merged, original branch deleted" — the user lands on a fresh
 * branch off main and can keep iterating.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { baseBranch?: string | null };
    const row = await continueExecutionSession({
      sessionId: id,
      baseBranchOverride: body.baseBranch ?? null,
    });
    if (!row) return Response.json({ error: 'Session not found' }, { status: 404 });
    return Response.json(row);
  } catch (err) {
    console.error('[POST /api/sessions/:id/continue]', err);
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: name, message }, { status: 500 });
  }
}
