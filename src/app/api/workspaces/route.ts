import { NextRequest } from 'next/server';
import path from 'node:path';
import { listWorkspaces, createWorkspace } from '@/lib/db/queries';
import { detectIsGit, detectBaseBranch, defaultWorktreeRoot } from '@/lib/workspaces';
import { parseConnectorScopes, validateConnectorScopes } from '@/lib/connectors/scopes';
import type { CreateWorkspaceInput, WorkspaceStatus } from '@/db/types';
import { withCompression } from '@/lib/api/compression';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const status = (params.get('status') ?? 'active') as WorkspaceStatus;
    const rows = listWorkspaces({ status });
    return Response.json(rows);
  } catch (err) {
    console.error('[GET /api/workspaces]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: Partial<CreateWorkspaceInput> & { name?: string; cwd?: string } = await request.json();

    if (!body.name) return Response.json({ error: 'name is required' }, { status: 400 });
    if (!body.cwd) return Response.json({ error: 'cwd is required' }, { status: 400 });

    const cwd = path.resolve(body.cwd);

    const isGit = body.isGit ?? (await detectIsGit(cwd));
    const baseBranch = isGit ? body.baseBranch ?? (await detectBaseBranch(cwd, body.remoteName ?? 'origin')) : null;

    // Connector scopes are optional at create. Validate identically to the edit path (no stored
    // scopes to preserve yet, no live sessions to recycle); fail-closed on a bad pin.
    let connectorScopes: CreateWorkspaceInput['connectorScopes'] | undefined;
    if (body.connectorScopes !== undefined) {
      const parsed = parseConnectorScopes(body.connectorScopes);
      if (!parsed) return Response.json({ error: 'connectorScopes must be an array of { toolkitId, account? }' }, { status: 400 });
      const result = await validateConnectorScopes(parsed);
      if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
      connectorScopes = result.scopes;
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
      worktreeRoot: isGit ? body.worktreeRoot ?? defaultWorktreeRoot(body.slug ?? body.name) : null,
      ...(body.filesToCopy !== undefined ? { filesToCopy: body.filesToCopy } : {}),
      setupCommand: body.setupCommand ?? null,
      startCommand: body.startCommand ?? null,
      teardownCommand: body.teardownCommand ?? null,
      areaId: body.areaId ?? null,
      status: body.status ?? 'active',
      browserEnabled: body.browserEnabled ?? true,
      ...(connectorScopes !== undefined ? { connectorScopes } : {}),
    });
    return Response.json(row, { status: 201 });
  } catch (err) {
    console.error('[POST /api/workspaces]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
