import { getWorkspace } from '@/lib/db/queries';
import { reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * List open issues for the workspace's repo via `@agentex/github`. The
 * "Create from → Issue" tab in the CreateFromModal renders these.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const state = (searchParams(rpcInput.query).get('state') ?? 'open') as 'open' | 'closed' | 'all';
    const ws = getWorkspace(id);
    if (!ws) return reply({ error: 'Workspace not found' }, { status: 404 });
    if (!ws.isGit) return reply([]);

    const { github } = await import('@agentex/github');
    const repo = github.repo(ws.cwd);
    const issues = await repo.listIssues({ state });
    return reply(issues);
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    console.error('[GET /api/workspaces/:id/github/issues]', err);
    return reply({ error: name, message }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ "state": rpcZ.string().optional() }).strict().optional() }).strict();
