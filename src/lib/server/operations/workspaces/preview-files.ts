import { reply, type OperationContext } from '@/lib/server/operation';
import { previewFilesToCopy } from '@/lib/workspaces/files-to-copy';
import path from 'node:path';
import { z as rpcZ } from 'zod/v4';

interface PreviewBody {
  cwd?: string;
  globs?: string[];
}

/**
 * Walk `cwd` and return the files that would be copied for the given globs.
 * Used by the create-workspace modal + settings sheet to preview the
 * `filesToCopy` field before save.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const body = (rpcInput.body) as PreviewBody;
    const cwd = body.cwd?.trim();
    const globs = Array.isArray(body.globs) ? body.globs : [];

    if (!cwd) return reply({ error: 'cwd is required' }, { status: 400 });

    const resolved = path.resolve(cwd);
    const result = await previewFilesToCopy(resolved, globs);
    return reply({ ...result, root: resolved });
  } catch (err) {
    console.error('[POST /api/workspaces/preview-files]', err);
    return reply({ error: String(err) }, { status: 400 });
  }
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({ "cwd": rpcZ.string().optional(), "globs": rpcZ.array(rpcZ.string()).optional() }).strict().default({}) }).strict();
