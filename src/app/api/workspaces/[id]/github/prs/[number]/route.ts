import type { NextRequest } from 'next/server';
import { getWorkspace } from '@/lib/db/queries';

/**
 * Fetch one PR's full detail (adds `body`, which the list endpoint omits).
 *
 * This is the launcher's **warm** step: picking a PR fires this so the
 * description is already in hand by the time the user hits Start, without
 * paying a body fetch for every row in the list. Nothing here mutates
 * state, so abandoning the modal just drops the response on the floor.
 *
 * Lazy-import `@agentex/github` for the same ESM-only-exports reason the
 * sibling list routes do.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; number: string }> },
) {
  try {
    const { id, number } = await params;
    const prNumber = parseInt(number, 10);
    if (!Number.isFinite(prNumber) || prNumber <= 0) {
      return Response.json({ error: 'Invalid PR number' }, { status: 400 });
    }
    const ws = getWorkspace(id);
    if (!ws) return Response.json({ error: 'Workspace not found' }, { status: 404 });
    if (!ws.isGit) return Response.json({ error: 'Not a git workspace' }, { status: 400 });

    const { github } = await import('@agentex/github');
    const detail = await github.repo(ws.cwd).getPR(prNumber);
    return Response.json(detail);
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    console.error('[GET /api/workspaces/:id/github/prs/:number]', err);
    return Response.json({ error: name, message }, { status: 500 });
  }
}
