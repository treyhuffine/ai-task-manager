import type { CreateWorkspaceInput, WorkspaceStatus } from '@/db/types';
import { parseIntegrationScopes, validateIntegrationScopes } from '@/lib/integrations/scopes';
import { archiveWorkspace, createWorkspace, listWorkspaces, WorkspaceFieldError } from '@/lib/db/queries';
import { workspaces } from '@/lib/db/schema';
import { reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { assertHomeFolderUsable, setHomeFolder, SetupError } from '@/lib/setups/home-context';
import { detectBaseBranch, detectIsGit } from '@/lib/workspaces';
import { createInsertSchema } from 'drizzle-zod';
import path from 'node:path';
import { z as rpcZ } from 'zod/v4';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const params = searchParams(rpcInput.query);
    const status = (params.get('status') ?? 'active') as WorkspaceStatus;
    const rows = listWorkspaces({ status });
    return reply(rows);
  } catch (err) {
    console.error('[GET /api/workspaces]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const body: Partial<CreateWorkspaceInput> & { name?: string; cwd?: string } = rpcInput.body;

    if (!body.name) return reply({ error: 'name is required' }, { status: 400 });
    if (!body.cwd) return reply({ error: 'cwd is required' }, { status: 400 });

    const cwd = path.resolve(body.cwd);
    // The folder becomes this agent's setup on this device: check it can
    // be before creating anything (docs/homes-spec.md §4.2).
    try {
      assertHomeFolderUsable(cwd);
    } catch (err) {
      if (err instanceof SetupError) return reply({ error: err.message }, { status: 400 });
      throw err;
    }

    const isGit = body.isGit ?? (await detectIsGit(cwd));
    const baseBranch = isGit ? body.baseBranch ?? (await detectBaseBranch(cwd, body.remoteName ?? 'origin')) : null;

    // Integration scopes are optional at create. Validate identically to the edit path (no stored
    // scopes to preserve yet, no live sessions to recycle); fail-closed on a bad pin.
    let integrationScopes: CreateWorkspaceInput['integrationScopes'] | undefined;
    if (body.integrationScopes !== undefined) {
      const parsed = parseIntegrationScopes(body.integrationScopes);
      if (!parsed) {
        return reply(
          { error: 'integrationScopes must be an array of { toolkitId, accounts? }, where each account is an email, label, account id or { accountId, authConfigId? }' },
          { status: 400 },
        );
      }
      const result = await validateIntegrationScopes(parsed);
      if (!result.ok) return reply({ error: result.error }, { status: 400 });
      integrationScopes = result.scopes;
    }

    const row = createWorkspace({
      name: body.name,
      slug: body.slug,
      emoji: body.emoji ?? null,
      attachments: body.attachments ?? [],
      cwd,
      isGit: isGit,
      baseBranch: baseBranch,
      remoteName: isGit ? body.remoteName ?? 'origin' : null,
      // Only a folder the person chose. Unset, each device puts worktrees in
      // its own Ri folder (`defaultWorktreeRoot`, resolved where they're made).
      worktreeRoot: isGit && typeof body.worktreeRoot === 'string' && body.worktreeRoot.trim() ? body.worktreeRoot.trim() : null,
      ...(body.filesToCopy !== undefined ? { filesToCopy: body.filesToCopy } : {}),
      setupCommand: body.setupCommand ?? null,
      startCommand: body.startCommand ?? null,
      teardownCommand: body.teardownCommand ?? null,
      areaId: body.areaId ?? null,
      ...(body.purpose !== undefined ? { purpose: body.purpose } : {}),
      ...(body.instructions !== undefined ? { instructions: body.instructions } : {}),
      status: body.status ?? 'active',
      browserEnabled: body.browserEnabled ?? true,
      ...(integrationScopes !== undefined ? { integrationScopes } : {}),
    });
    // The folder is this device's setup for the agent, kept in the folder's
    // own `.ri.local.json` (docs/homes-spec.md §4). If that fails after the
    // check above (a race, a disk error), the new agent is archived rather
    // than left without a folder, and the reason returned.
    try {
      await setHomeFolder(row.id, cwd);
    } catch (err) {
      archiveWorkspace(row.id);
      return reply(
        { error: `The agent's folder couldn't be set up: ${err instanceof Error ? err.message : String(err)}` },
        { status: err instanceof SetupError ? 409 : 500 },
      );
    }
    return reply(row, { status: 201 });
  } catch (err) {
    if (err instanceof WorkspaceFieldError) {
      return reply({ error: err.message }, { status: 400 });
    }
    console.error('[POST /api/workspaces]', err);
    return reply({ error: String(err) }, { status: 400 });
  }
}

export const GETInput = rpcZ.object({ query: rpcZ.object({ "status": rpcZ.string().optional() }).strict().optional() }).strict().default({});
export const POSTInput = rpcZ.object({ body: createInsertSchema(workspaces).pick({ "name": true, "status": true, "slug": true, "emoji": true, "cwd": true, "isGit": true, "baseBranch": true, "remoteName": true, "worktreeRoot": true, "setupCommand": true, "teardownCommand": true, "startCommand": true, "createdAt": true, "updatedAt": true, "areaId": true, "purpose": true, "instructions": true, "defaultDeviceId": true, "position": true, "collapsed": true, "skipLiveConfirm": true, "browserEnabled": true, "archivedAt": true }).partial().extend({ "filesToCopy": rpcZ.array(rpcZ.string()).optional(), "integrationScopes": rpcZ.array(rpcZ.object({ "toolkitId": rpcZ.string(), "accounts": rpcZ.array(rpcZ.object({ "accountId": rpcZ.string(), "authConfigId": rpcZ.string().optional() }).strict()).optional(), "account": rpcZ.object({ "accountId": rpcZ.string(), "authConfigId": rpcZ.string().optional() }).strict().optional() }).strict()).optional(), "attachments": rpcZ.union([rpcZ.null(), rpcZ.array(rpcZ.object({ "fileName": rpcZ.string(), "originalName": rpcZ.string(), "mimeType": rpcZ.string(), "size": rpcZ.number().finite(), "uploadedAt": rpcZ.string() }).strict())]).optional() }).strict().default({}) }).strict();
