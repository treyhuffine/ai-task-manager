import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, touchSessionActivity } from '@/lib/db/queries';
import { githubOnOwner } from '@/lib/executor/owner-git';
import { whileAdmitted } from '@/lib/transfer/moving';

/**
 * Merge the PR for this session via `@agentex/github`. The caller has
 * already confirmed the user wants to merge (the action bar pops a
 * confirm dialog before POSTing). Body accepts an optional method
 * override; defaults to `squash` because that's by far the most
 * common merge style for short-lived feature branches and produces
 * the cleanest history.
 */
export interface MergeRequestBody {
  method?: 'merge' | 'squash' | 'rebase';
  deleteBranch?: boolean;
}

async function handlePOST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as MergeRequestBody;

    const session = getChatSessionWithExecution(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (!session.workspaceId || !session.branchName) {
      return Response.json(
        { error: 'noWorktree', message: 'No branch on this session.' },
        { status: 400 },
      );
    }

    // In a clone of its repository: the agent's folder here, or on the
    // computer the agent lives on (P4.5).
    const res = await githubOnOwner(id, {
      op: 'merge',
      prNumber: session.prNumber,
      branchName: session.branchName,
      method: body.method ?? 'squash',
      deleteBranch: body.deleteBranch ?? true,
    });
    if (res.ok) touchSessionActivity(id, 'git');
    return res;
  } catch (err) {
    console.error('[POST /api/sessions/:id/merge]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

/** Counted while it runs, and refused while the work moves (P4 review). */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return whileAdmitted(id, 'merging its pull request', () => handlePOST(request, context));
}
