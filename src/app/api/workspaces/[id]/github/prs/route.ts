import type { NextRequest } from 'next/server';
import { getWorkspace } from '@/lib/db/queries';

/**
 * List open PRs for the workspace's repo via `@agentex/github`. The
 * "Create from → Pull Request" tab in the CreateFromModal renders these.
 *
 * Lazy-import the github lib for the same ESM-only-exports reason the
 * workspace lib is — Next.js bundles these route handlers in a way
 * that occasionally trips static `import` of pure-ESM packages.
 */
export async function GET(
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
