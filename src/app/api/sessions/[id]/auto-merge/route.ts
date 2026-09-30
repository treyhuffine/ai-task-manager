import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution } from '@/lib/db/queries';
import type { MergeMethod } from '@/lib/github/auto-merge';
import { MERGE_METHODS } from '@/lib/github/execution-github';
import { githubOnOwner } from '@/lib/executor/owner-git';
import { whileAdmitted } from '@/lib/transfer/moving';

export const runtime = 'nodejs';

/**
 * Enable or disable GitHub auto-merge ("merge when ready") for this
 * session's PR. Enabling runs a GraphQL preflight first so we return a
 * precise reason (409) instead of a raw gh error when the repo or PR
 * doesn't allow it.
 */
export interface AutoMergeRequestBody {
  enable: boolean;
  method?: MergeMethod;
}

async function handlePOST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { enable?: unknown; method?: unknown };
    // Reject malformed input rather than silently coercing it: `{enable:"true"}`
    // must not disable, and a bogus `method` must not fall through to squash.
    if (typeof body.enable !== 'boolean') {
      return Response.json(
        { error: 'invalid_request', message: 'enable must be a boolean' },
        { status: 400 },
      );
    }
    if (
      body.method !== undefined &&
      !(typeof body.method === 'string' && MERGE_METHODS.includes(body.method as MergeMethod))
    ) {
      return Response.json(
        { error: 'invalid_request', message: 'method must be one of: squash, merge, rebase' },
        { status: 400 },
      );
    }
    const enable = body.enable;
    const requestedMethod = body.method as MergeMethod | undefined;

    const session = getChatSessionWithExecution(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (!session.workspaceId || !session.branchName) {
      return Response.json(
        { error: 'noWorktree', message: 'No branch on this session.' },
        { status: 400 },
      );
    }

    // In a clone of its repository: the agent's folder here, or on the
    // device the agent lives on (P4.5).
    return await githubOnOwner(id, {
      op: 'auto_merge',
      prNumber: session.prNumber,
      branchName: session.branchName,
      enable,
      method: requestedMethod,
    });
  } catch (err) {
    console.error('[POST /api/sessions/:id/auto-merge]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

/** Counted while it runs, and refused while the work moves (P4 review). */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return whileAdmitted(id, 'changing auto-merge', () => handlePOST(request, context));
}
