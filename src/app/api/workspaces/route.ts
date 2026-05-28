import { NextRequest } from 'next/server';
import path from 'node:path';
import { listWorkspaces, createWorkspace } from '@/lib/db/queries';
import { detectIsGit, detectBaseBranch, defaultWorktreeRoot } from '@/lib/workspaces';
import type { CreateWorkspaceInput, WorkspaceStatus } from '@/db/types';

export async function GET(request: NextRequest) {
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
      areaId: body.areaId ?? null,
      status: body.status ?? 'active',
    });
    return Response.json(row, { status: 201 });
  } catch (err) {
    console.error('[POST /api/workspaces]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
