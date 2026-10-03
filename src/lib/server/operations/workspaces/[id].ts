import { getWorkspace, updateWorkspace, validateWorkspaceUpdate, WorkspaceFieldError } from '@/lib/db/queries';
import { workspaces } from '@/lib/db/schema';
import { recycleAgentMainChats, recycleWorkspaceSessions } from '@/lib/executor/adapter';
import { reply, type OperationContext } from '@/lib/server/operation';
import { createInsertSchema } from 'drizzle-zod';
import path from 'node:path';
import { z as rpcZ } from 'zod/v4';

/** Fields every live session of the agent receives at spawn: its executions and its main chat. */
const SESSION_FIELDS = ['browserEnabled', 'instructions', 'cwd', 'isGit'] as const;
/** Fields only the agent's main chat receives (they are in its brief, not in executions). */
const MAIN_CHAT_FIELDS = ['name', 'purpose'] as const;

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const row = getWorkspace(id);
    if (!row) return reply({ error: 'Workspace not found' }, { status: 404 });
    return reply(row);
  } catch (err) {
    console.error('[GET /api/workspaces/:id]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

class WorkspaceMissingError extends Error { }

export async function PATCH(rpcInput: rpcZ.infer<typeof PATCHInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    // `connectorScopes` is security-relevant (it governs what a workspace's executions may touch) and
    // must go through PUT /connector-scopes, which validates pins and recycles live sessions. Strip it
    // here so the generic PATCH can't write scopes unvalidated and without a session recycle.
    const raw = rpcInput.body;
    // Check the whole patch before changing anything, so a bad field can't
    // leave the folder already moved.
    const body = validateWorkspaceUpdate(raw);
    const before = getWorkspace(id);
    if (!before) return reply({ error: 'Workspace not found' }, { status: 404 });

    if (typeof body.cwd === 'string') body.cwd = path.resolve(body.cwd);
    // Assigned inside `finish` too, so declared without narrowing to null.
    let row = null as ReturnType<typeof updateWorkspace>;
    if (typeof body.cwd === 'string' && body.cwd !== before.cwd) {
      // A new folder for the agent on the home (docs/homes-spec.md §4.1):
      // checked first, and recorded once the agent is saved.
      const { setHomeFolder, SetupError } = await import('@/lib/setups/home-context');
      try {
        await setHomeFolder(id, body.cwd, {
          finish: () => {
            row = updateWorkspace(id, body);
            if (!row) throw new WorkspaceMissingError();
          },
        });
      } catch (err) {
        if (err instanceof WorkspaceMissingError) return reply({ error: 'Workspace not found' }, { status: 404 });
        if (err instanceof SetupError) {
          return reply({ error: err.message }, { status: 400 });
        }
        throw err;
      }
    } else {
      row = updateWorkspace(id, body);
    }
    if (!row) return reply({ error: 'Workspace not found' }, { status: 404 });
    // Session config is fixed at spawn (the browser changes the tool set, the
    // instructions and folder are read at spawn), so recycle live sessions to
    // apply a change now rather than only on the next session. The next
    // message resumes the same chat, and a session mid-turn is recycled when
    // its turn ends. Name and purpose only reach the agent's main chat.
    if (SESSION_FIELDS.some((field) => field in body)) await recycleWorkspaceSessions(id);
    else if (MAIN_CHAT_FIELDS.some((field) => field in body)) await recycleAgentMainChats(id);
    return reply(row);
  } catch (err) {
    if (err instanceof WorkspaceFieldError) {
      return reply({ error: err.message }, { status: 400 });
    }
    console.error('[PATCH /api/workspaces/:id]', err);
    return reply({ error: String(err) }, { status: 400 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
export const PATCHInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: createInsertSchema(workspaces).pick({ "name": true, "status": true, "slug": true, "emoji": true, "cwd": true, "isGit": true, "baseBranch": true, "remoteName": true, "worktreeRoot": true, "setupCommand": true, "teardownCommand": true, "startCommand": true, "updatedAt": true, "areaId": true, "purpose": true, "instructions": true, "defaultDeviceId": true, "position": true, "collapsed": true, "skipLiveConfirm": true, "browserEnabled": true, "archivedAt": true }).partial().extend({ "attachments": rpcZ.union([rpcZ.null(), rpcZ.array(rpcZ.object({ "fileName": rpcZ.string(), "originalName": rpcZ.string(), "mimeType": rpcZ.string(), "size": rpcZ.number().finite(), "uploadedAt": rpcZ.string() }).strict())]).optional(), "filesToCopy": rpcZ.array(rpcZ.string()).optional() }).strip().default({}) }).strict();
