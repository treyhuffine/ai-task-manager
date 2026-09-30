/**
 * An agent's own folder for the agent view's Files tab
 * (docs/agents-view-spec.md Phase 5), wherever the agent lives (P3.5). Lives
 * outside the `route.ts` files because Next.js's app router rejects exports
 * that aren't HTTP method handlers or segment configs.
 *
 * At home it reads and writes the folder here. For an agent that lives on
 * another computer it asks that computer, which uses the agent's folder there
 * as the home recorded it: never a folder at home, and never a path the
 * caller names.
 *
 * Writes (the Files tab's editor and tree) go to the folder by path, so they
 * work for git, plain and detached-HEAD folders alike. They are for the
 * person using the app. The agent's main chat still never writes here
 * (docs/agents-view-spec.md Phase 6): its changes go through executions. An
 * archived agent is read-only (409), like its terminal and main chat.
 */

import { getComputer, getWorkspace } from '@/lib/db/queries';
import { agentComputerFor } from '@/lib/setups/run-on';
import { isExistingDir } from '@/lib/terminal/owner';
import { requestWorker, WorkerRequestError, WorkerUnavailableError } from '@/lib/workers/hub';
import type { ReadAgentFolderRequest, WriteAgentFolderRequest } from '@/lib/workers/protocol';
import { readAgentFolder, type AgentFolderRead } from '@/lib/workspaces/agent-folder-reads';
import { writeFolder, type FolderWrite } from '@/lib/workspaces/execution-writes';

async function onItsComputer(computerId: string, kind: 'read_agent_folder' | 'write_agent_folder', request: unknown): Promise<Response> {
  const name = getComputer(computerId)?.name ?? 'Its computer';
  try {
    const answer = (await requestWorker(computerId, kind, request)) as { status: number; body: unknown };
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

export async function agentFolderResponse(id: string, read: AgentFolderRead): Promise<Response> {
  const ws = getWorkspace(id);
  if (!ws) return Response.json({ error: 'Workspace not found' }, { status: 404 });
  const computerId = agentComputerFor(id);
  if (computerId) {
    const request: ReadAgentFolderRequest = { agentId: id, filesToCopy: ws.filesToCopy ?? [], read };
    return onItsComputer(computerId, 'read_agent_folder', request);
  }
  if (!isExistingDir(ws.cwd)) {
    return Response.json({ error: `The agent's folder does not exist: ${ws.cwd}` }, { status: 409 });
  }
  const answer = await readAgentFolder(ws.cwd, ws.filesToCopy ?? [], read);
  return Response.json(answer.body, { status: answer.status });
}

/** A person's change to the agent's own folder, on the computer it lives on. */
export async function agentFolderWrite(id: string, write: FolderWrite): Promise<Response> {
  const ws = getWorkspace(id);
  if (!ws) return Response.json({ error: 'Workspace not found' }, { status: 404 });
  if (ws.status === 'archived') {
    return Response.json({ error: 'This agent is archived, so its files are read-only' }, { status: 409 });
  }
  const computerId = agentComputerFor(id);
  if (computerId) {
    const request: WriteAgentFolderRequest = { agentId: id, isGit: ws.isGit, write };
    return onItsComputer(computerId, 'write_agent_folder', request);
  }
  if (!isExistingDir(ws.cwd)) {
    return Response.json({ error: `The agent's folder does not exist: ${ws.cwd}` }, { status: 409 });
  }
  const answer = await writeFolder({ path: ws.cwd, kind: ws.isGit ? 'git' : 'bare' }, write);
  return Response.json(answer.body, { status: answer.status });
}
