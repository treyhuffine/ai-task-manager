/**
 * An agent's own folder for the agent view's Files tab
 * (docs/agents-view-spec.md Phase 5), wherever the agent lives (P3.5). Lives
 * outside the `route.ts` files because Next.js's app router rejects exports
 * that aren't HTTP method handlers or segment configs.
 *
 * At home it reads and writes the folder here. For an agent that lives on
 * another device it asks that device, which uses the agent's folder there
 * as the home recorded it: never a folder at home, and never a path the
 * caller names.
 *
 * Writes (the Files tab's editor and tree) go to the folder by path, so they
 * work for git, plain and detached-HEAD folders alike. They are for the
 * person using the app. The agent's main chat still never writes here
 * (docs/agents-view-spec.md Phase 6): its changes go through executions. An
 * archived agent is read-only (409), like its terminal and main chat.
 */

import { getDevice, getWorkspace } from '@/lib/db/queries';
import { agentDeviceFor } from '@/lib/setups/run-on';
import { isExistingDir } from '@/lib/terminal/owner';
import { requestWorker, WorkerRequestError, WorkerUnavailableError } from '@/lib/workers/hub';
import type { ReadAgentFolderRequest, WriteAgentFolderRequest } from '@/lib/workers/protocol';
import { readAgentFolder, type AgentFolderRead } from '@/lib/workspaces/agent-folder-reads';
import { writeFolder, type FolderWrite } from '@/lib/workspaces/execution-writes';

async function onItsDevice(deviceId: string, kind: 'read_agent_folder' | 'write_agent_folder', request: unknown) {
  const name = getDevice(deviceId)?.name ?? 'Its device';
  try {
    const answer = (await requestWorker(deviceId, kind, request)) as { status: number; body: unknown };
    return ({ body: answer.body, status: ({ status: answer.status }).status ?? 200 });
  } catch (err) {
    if (err instanceof WorkerUnavailableError) {
      return ({ body: { error: 'unavailable', message: `${name} is not connected right now.` }, status: ({ status: 409 }).status ?? 200 });
    }
    if (err instanceof WorkerRequestError) {
      return ({ body: { error: 'worker_error', message: err.message }, status: ({ status: 424 }).status ?? 200 });
    }
    throw err;
  }
}

export async function agentFolderAnswer(id: string, read: AgentFolderRead) {
  const ws = getWorkspace(id);
  if (!ws) return ({ body: { error: 'Workspace not found' }, status: ({ status: 404 }).status ?? 200 });
  const deviceId = agentDeviceFor(id);
  if (deviceId) {
    const request: ReadAgentFolderRequest = { agentId: id, filesToCopy: ws.filesToCopy ?? [], read };
    return onItsDevice(deviceId, 'read_agent_folder', request);
  }
  if (!isExistingDir(ws.cwd)) {
    return ({ body: { error: `The agent's folder does not exist: ${ws.cwd}` }, status: ({ status: 409 }).status ?? 200 });
  }
  const answer = await readAgentFolder(ws.cwd, ws.filesToCopy ?? [], read);
  return ({ body: answer.body, status: ({ status: answer.status }).status ?? 200 });
}

/** A person's change to the agent's own folder, on the device it lives on. */
export async function agentFolderWriteAnswer(id: string, write: FolderWrite) {
  const ws = getWorkspace(id);
  if (!ws) return ({ body: { error: 'Workspace not found' }, status: ({ status: 404 }).status ?? 200 });
  if (ws.status === 'archived') {
    return ({ body: { error: 'This agent is archived, so its files are read-only' }, status: ({ status: 409 }).status ?? 200 });
  }
  const deviceId = agentDeviceFor(id);
  if (deviceId) {
    const request: WriteAgentFolderRequest = { agentId: id, isGit: ws.isGit, write };
    return onItsDevice(deviceId, 'write_agent_folder', request);
  }
  if (!isExistingDir(ws.cwd)) {
    return ({ body: { error: `The agent's folder does not exist: ${ws.cwd}` }, status: ({ status: 409 }).status ?? 200 });
  }
  const answer = await writeFolder({ path: ws.cwd, kind: ws.isGit ? 'git' : 'bare' }, write);
  return ({ body: answer.body, status: ({ status: answer.status }).status ?? 200 });
}
