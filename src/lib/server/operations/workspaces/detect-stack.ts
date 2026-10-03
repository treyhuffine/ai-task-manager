import { reply, type OperationContext } from '@/lib/server/operation';
import { detectStack } from '@/lib/workspaces/detect-stack';
import path from 'node:path';
import { z as rpcZ } from 'zod/v4';

/**
 * Suggest setup/start commands from the files in a checkout — drives the
 * placeholders in the Worktree-scripts UI. Read-only; never runs anything.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const body = (rpcInput.body) as { cwd?: string };
    const cwd = body.cwd?.trim();
    if (!cwd) return reply({ setup: '', start: '' });
    return reply(detectStack(path.resolve(cwd)));
  } catch (err) {
    console.error('[POST /api/workspaces/detect-stack]', err);
    return reply({ setup: '', start: '' });
  }
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({ "cwd": rpcZ.string().optional() }).strict().default({}) }).strict();
