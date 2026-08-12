import type { NextRequest } from 'next/server';
import { getWorkspace } from '@/lib/db/queries';
import { withCompression } from '@/lib/api/compression';

/**
 * List open PRs for the workspace's repo via `@agentex/github`. The
 * "Create from → Pull Request" tab in the CreateFromModal renders these.
 *
 * Lazy-import the github lib for the same ESM-only-exports reason the
 * workspace lib is — Next.js bundles these route handlers in a way
 * that occasionally trips static `import` of pure-ESM packages.
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
    const state = (request.nextUrl.searchParams.get('state') ?? 'open') as 'open' | 'closed' | 'merged' | 'all';
    const ws = getWorkspace(id);
    if (!ws) return Response.json({ error: 'Workspace not found' }, { status: 404 });
    if (!ws.isGit) return Response.json([]);

    const { github } = await import('@agentex/github');
    const repo = github.repo(ws.cwd);
    const prs = await repo.listPRs({ state });
    return Response.json(prs);
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    console.error('[GET /api/workspaces/:id/github/prs]', err);
    return Response.json({ error: name, message }, { status: 500 });
  }
}
