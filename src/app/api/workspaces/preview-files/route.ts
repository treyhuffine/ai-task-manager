import { NextRequest } from 'next/server';
import path from 'node:path';
import { previewFilesToCopy } from '@/lib/workspaces/files-to-copy';

interface PreviewBody {
  cwd?: string;
  globs?: string[];
}

/**
 * Walk `cwd` and return the files that would be copied for the given globs.
 * Used by the create-workspace modal + settings sheet to preview the
 * `files_to_copy` field before save.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PreviewBody;
    const cwd = body.cwd?.trim();
    const globs = Array.isArray(body.globs) ? body.globs : [];

    if (!cwd) return Response.json({ error: 'cwd is required' }, { status: 400 });

    const resolved = path.resolve(cwd);
    const result = await previewFilesToCopy(resolved, globs);
    return Response.json({ ...result, root: resolved });
  } catch (err) {
    console.error('[POST /api/workspaces/preview-files]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
