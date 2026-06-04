import type { NextRequest } from 'next/server';
import path from 'node:path';
import { detectStack } from '@/lib/workspaces/detect-stack';

/**
 * Suggest setup/start commands from the files in a checkout — drives the
 * placeholders in the Worktree-scripts UI. Read-only; never runs anything.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { cwd?: string };
    const cwd = body.cwd?.trim();
    if (!cwd) return Response.json({ setup: '', start: '' });
    return Response.json(detectStack(path.resolve(cwd)));
  } catch (err) {
    console.error('[POST /api/workspaces/detect-stack]', err);
    return Response.json({ setup: '', start: '' });
  }
}
