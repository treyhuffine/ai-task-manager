import type { NextRequest } from 'next/server';
import { getWorkspace } from '@/lib/db/queries';
import { withCompression } from '@/lib/api/compression';

/**
 * List open issues for the workspace's repo via `@agentex/github`. The
 * "Create from → Issue" tab in the CreateFromModal renders these.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const state = (request.nextUrl.searchParams.get('state') ?? 'open') as 'open' | 'closed' | 'all';
    const ws = getWorkspace(id);
    if (!ws) return Response.json({ error: 'Workspace not found' }, { status: 404 });
    if (!ws.isGit) return Response.json([]);

    const { github } = await import('@agentex/github');
    const repo = github.repo(ws.cwd);
    const issues = await repo.listIssues({ state });
    return Response.json(issues);
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    console.error('[GET /api/workspaces/:id/github/issues]', err);
    return Response.json({ error: name, message }, { status: 500 });
  }
}
