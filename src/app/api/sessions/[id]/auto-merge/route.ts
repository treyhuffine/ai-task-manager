import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import {
  getAutoMergeEligibility,
  enableAutoMerge,
  disableAutoMerge,
  type MergeMethod,
} from '@/lib/github/auto-merge';
import { resolveSessionPr } from '@/lib/github/session-pr';

const MERGE_METHODS: readonly MergeMethod[] = ['squash', 'merge', 'rebase'];

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

export async function POST(
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

    const ws = getWorkspace(session.workspaceId);
    if (!ws) return Response.json({ error: 'Workspace not found' }, { status: 404 });

    const { github, NotInstalledError, NotAuthenticatedError } = await import('@agentex/github');
    const repo = github.repo(ws.cwd);

    try {
      // Resolve the same PR the action bar shows (linked prNumber wins, then
      // branch/suffix match) so the toggle never targets a different PR.
      const pr = await resolveSessionPr(repo, session);
      if (!pr || pr.state !== 'OPEN') {
        return Response.json(
          { error: 'no_open_pr', message: 'No open PR for this session.' },
          { status: 404 },
        );
      }

      if (enable) {
        // Preflight is best-effort — if it errors we still try the enable and
        // let gh report the real failure.
        const elig = await getAutoMergeEligibility(ws.cwd, pr.number).catch(() => null);
        if (elig && !elig.canEnable && !elig.enabled) {
          return Response.json(
            { error: 'auto_merge_unavailable', message: elig.reason ?? 'Auto-merge cannot be enabled.' },
            { status: 409 },
          );
        }
        const method: MergeMethod =
          requestedMethod ??
          (elig?.allowedMethods.includes('squash') ? 'squash' : elig?.allowedMethods[0] ?? 'squash');
        await enableAutoMerge(ws.cwd, pr.number, method);
        return Response.json({ ok: true, enabled: true, prNumber: pr.number, url: pr.url });
      }

      await disableAutoMerge(ws.cwd, pr.number);
      return Response.json({ ok: true, enabled: false, prNumber: pr.number, url: pr.url });
    } catch (err) {
      if (err instanceof NotInstalledError || err instanceof NotAuthenticatedError) {
        return Response.json({ error: err.message }, { status: 412 });
      }
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ error: 'auto_merge_failed', message }, { status: 409 });
    }
  } catch (err) {
    console.error('[POST /api/sessions/:id/auto-merge]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
