import type { NextRequest } from 'next/server';
import { getWorkspace } from '@/lib/db/queries';
import { withCompression } from '@/lib/api/compression';

/**
 * Fetch one issue's full detail (adds `body`, which the list endpoint omits).
 * The launcher's warm step for an issue pick — see the PR sibling route.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; number: string }> },
) {
  try {
    const { id, number } = await params;
    const issueNumber = parseInt(number, 10);
    if (!Number.isFinite(issueNumber) || issueNumber <= 0) {
      return Response.json({ error: 'Invalid issue number' }, { status: 400 });
    }
    const ws = getWorkspace(id);
    if (!ws) return Response.json({ error: 'Workspace not found' }, { status: 404 });
    if (!ws.isGit) return Response.json({ error: 'Not a git workspace' }, { status: 400 });

    const { github } = await import('@agentex/github');
    const detail = await github.repo(ws.cwd).getIssue(issueNumber);
    return Response.json(detail);
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    console.error('[GET /api/workspaces/:id/github/issues/:number]', err);
    return Response.json({ error: name, message }, { status: 500 });
  }
}
