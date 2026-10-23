import type { CreateWorkspaceInput, WorkspaceStatus } from '@/db/types';
import { listWorkspaces, getHome, WorkspaceFieldError, isTeamError } from '@/lib/db/queries';
import { workspaces } from '@/lib/db/schema';
import { reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { createInsertSchema } from 'drizzle-zod';
import { z as rpcZ } from 'zod/v4';
import { WorkResultGuidanceError } from '@/lib/instructions/preferences';
import { workspaceReviewPreferencesSchema } from '@/lib/workspaces/review-preferences';
import { requestHasSessionAuthority } from '@/lib/orchestrator/mcp-caller';
import { getRequestKey } from '@/lib/auth/request-key';
import { authorizeTeamExecution } from '@/lib/home/execution-authority';
import { createWorkspaceForHome, WorkspaceCreationError } from '@/lib/workspaces/create-for-home';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  try {
    if (getHome()?.kind === 'team') authorizeTeamExecution(getRequestKey(request.headers), { operation: 'readCatalog' });
    const params = searchParams(rpcInput.query);
    const status = (params.get('status') ?? 'active') as WorkspaceStatus;
    const rows = listWorkspaces({ status });
    return reply(rows);
  } catch (err) {
    if (isTeamError(err)) return reply({ error: err.code, message: err.message }, { status: err.code === 'not_allowed' ? 403 : err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : 400 });
    console.error('[GET /api/workspaces]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  try {
    const body: Partial<CreateWorkspaceInput> & { name?: string; cwd?: string } = rpcInput.body;
    if (['workResultGuidance', 'reviewBeforeHandoff', 'reviewDefaults'].some((field) => field in body)
      && requestHasSessionAuthority(request.headers)) {
      return reply({ error: 'Only the owner can choose handoff and review preferences for a new agent.', code: 'unsupported' }, { status: 403 });
    }
    const review = workspaceReviewPreferencesSchema.safeParse({ reviewBeforeHandoff: body.reviewBeforeHandoff, reviewDefaults: body.reviewDefaults });
    if (!review.success) return reply({ error: 'Invalid reviewer preferences.', code: 'invalid_params' }, { status: 400 });

    if (!body.name) return reply({ error: 'name is required' }, { status: 400 });
    if (!body.cwd) return reply({ error: 'cwd is required' }, { status: 400 });

    const row = await createWorkspaceForHome({ ...body, ...review.data, name: body.name, cwd: body.cwd }, getRequestKey(request.headers));
    return reply(row, { status: 201 });
  } catch (err) {
    if (isTeamError(err)) return reply({ error: err.code, message: err.message }, { status: err.code === 'not_allowed' ? 403 : err.code === 'not_found' ? 404 : err.code === 'conflict' ? 409 : 400 });
    if (err instanceof WorkspaceCreationError) return reply({ error: err.message }, { status: err.status });
    if (err instanceof WorkspaceFieldError) {
      return reply({ error: err.message }, { status: 400 });
    }
    if (err instanceof WorkResultGuidanceError) return reply({ error: err.message, code: err.code }, { status: 400 });
    console.error('[POST /api/workspaces]', err);
    return reply({ error: String(err) }, { status: 400 });
  }
}

export const GETInput = rpcZ.object({ query: rpcZ.object({ "status": rpcZ.string().optional() }).strict().optional() }).strict().default({});
export const POSTInput = rpcZ.object({ body: createInsertSchema(workspaces).pick({ "name": true, "status": true, "slug": true, "emoji": true, "cwd": true, "isGit": true, "baseBranch": true, "remoteName": true, "worktreeRoot": true, "setupCommand": true, "teardownCommand": true, "startCommand": true, "createdAt": true, "updatedAt": true, "areaId": true, "purpose": true, "instructions": true, "workResultGuidance": true, "reviewBeforeHandoff": true, "reviewDefaults": true, "defaultDeviceId": true, "position": true, "collapsed": true, "skipLiveConfirm": true, "browserEnabled": true, "archivedAt": true }).partial().extend({ "filesToCopy": rpcZ.array(rpcZ.string()).optional(), "integrationScopes": rpcZ.array(rpcZ.object({ "toolkitId": rpcZ.string(), "accounts": rpcZ.array(rpcZ.object({ "accountId": rpcZ.string(), "authConfigId": rpcZ.string().optional() }).strict()).optional(), "account": rpcZ.object({ "accountId": rpcZ.string(), "authConfigId": rpcZ.string().optional() }).strict().optional() }).strict()).optional(), "attachments": rpcZ.union([rpcZ.null(), rpcZ.array(rpcZ.object({ "fileName": rpcZ.string(), "originalName": rpcZ.string(), "mimeType": rpcZ.string(), "size": rpcZ.number().finite(), "uploadedAt": rpcZ.string() }).strict())]).optional() }).strict().default({}) }).strict();
