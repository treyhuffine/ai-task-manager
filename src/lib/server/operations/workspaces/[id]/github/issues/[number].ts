import { getWorkspace } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Fetch one issue's full detail (adds `body`, which the list endpoint omits).
 * The launcher's warm step for an issue pick — see the PR sibling route.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id, number } = rpcInput.params;
    const issueNumber = parseInt(number, 10);
    if (!Number.isFinite(issueNumber) || issueNumber <= 0) {
      return reply({ error: 'Invalid issue number' }, { status: 400 });
    }
    const ws = getWorkspace(id);
    if (!ws) return reply({ error: 'Workspace not found' }, { status: 404 });
    if (!ws.isGit) return reply({ error: 'Not a git workspace' }, { status: 400 });

    const { github } = await import('@agentex/github');
    const detail = await github.repo(ws.cwd).getIssue(issueNumber);
    return reply(detail);
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    console.error('[GET /api/workspaces/:id/github/issues/:number]', err);
    return reply({ error: name, message }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1), "number": rpcZ.string().min(1) }).strict() }).strict();
