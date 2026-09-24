import { NextRequest } from 'next/server';
import path from 'node:path';
import { archiveWorkspace, listWorkspaces, createWorkspace, WorkspaceFieldError } from '@/lib/db/queries';
import { detectIsGit, detectBaseBranch, defaultWorktreeRoot } from '@/lib/workspaces';
import { parseConnectorScopes, validateConnectorScopes } from '@/lib/connectors/scopes';
import type { CreateWorkspaceInput, WorkspaceStatus } from '@/db/types';
import { withCompression } from '@/lib/api/compression';
import { assertHomeFolderUsable, setHomeFolder } from '@/lib/setups/home-context';
import { SetupError } from '@/lib/setups/service';

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
    // The folder becomes this agent's setup on this computer: check it can
    // be before creating anything (docs/homes-spec.md §4.2).
    try {
      assertHomeFolderUsable(cwd);
    } catch (err) {
      if (err instanceof SetupError) return Response.json({ error: err.message }, { status: 400 });
      throw err;
    }

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
      ...(body.purpose !== undefined ? { purpose: body.purpose } : {}),
      ...(body.instructions !== undefined ? { instructions: body.instructions } : {}),
      status: body.status ?? 'active',
      browserEnabled: body.browserEnabled ?? true,
      ...(connectorScopes !== undefined ? { connectorScopes } : {}),
    });
    // The folder is this computer's setup for the agent, kept in the folder's
    // own `.ri.local.json` (docs/homes-spec.md §4). If that fails after the
    // check above (a race, a disk error), the new agent is archived rather
    // than left without a folder, and the reason returned.
    try {
      await setHomeFolder(row.id, cwd);
    } catch (err) {
      archiveWorkspace(row.id);
      return Response.json(
        { error: `The agent's folder couldn't be set up: ${err instanceof Error ? err.message : String(err)}` },
        { status: err instanceof SetupError ? 409 : 500 },
      );
    }
    return Response.json(row, { status: 201 });
  } catch (err) {
    if (err instanceof WorkspaceFieldError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error('[POST /api/workspaces]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
