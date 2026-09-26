/**
 * Read an agent's own folder for the agent view's Files tab
 * (docs/agents-view-spec.md Phase 5), wherever the agent lives (P3.5). Lives
 * outside the `route.ts` files because Next.js's app router rejects exports
 * that aren't HTTP method handlers or segment configs.
 *
 * At home it reads the folder here. For an agent that lives on another
 * computer it asks that computer, which reads its folder there from its own
 * setup files: never a folder at home, and never a path the caller names.
 */

import { getComputer, getWorkspace } from '@/lib/db/queries';
import { agentComputerFor } from '@/lib/setups/run-on';
import { isExistingDir } from '@/lib/terminal/owner';
import { requestWorker, WorkerRequestError, WorkerUnavailableError } from '@/lib/workers/hub';
import type { ReadAgentFolderRequest } from '@/lib/workers/protocol';
import { readAgentFolder, type AgentFolderRead } from '@/lib/workspaces/agent-folder-reads';

export async function agentFolderResponse(id: string, read: AgentFolderRead): Promise<Response> {
  const ws = getWorkspace(id);
  if (!ws) return Response.json({ error: 'Workspace not found' }, { status: 404 });
  const computerId = agentComputerFor(id);
  if (computerId) {
    const name = getComputer(computerId)?.name ?? 'Its computer';
    const request: ReadAgentFolderRequest = { agentId: id, filesToCopy: ws.filesToCopy ?? [], read };
    try {
      const answer = (await requestWorker(computerId, 'read_agent_folder', request)) as { status: number; body: unknown };
      return Response.json(answer.body, { status: answer.status });
    } catch (err) {
      if (err instanceof WorkerUnavailableError) {
        return Response.json({ error: 'unavailable', message: `${name} is not connected right now.` }, { status: 409 });
      }
      if (err instanceof WorkerRequestError) {
        return Response.json({ error: 'worker_error', message: err.message }, { status: 424 });
      }
      throw err;
    }
  }
  if (!isExistingDir(ws.cwd)) {
    return Response.json({ error: `The agent's folder does not exist: ${ws.cwd}` }, { status: 409 });
  }
  const answer = await readAgentFolder(ws.cwd, ws.filesToCopy ?? [], read);
  return Response.json(answer.body, { status: answer.status });
}
