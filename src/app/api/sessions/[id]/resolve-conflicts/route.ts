import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getChatSession, getWorkspace, insertChatEvent } from '@/lib/db/queries';
import { openWorktreeHandle } from '@/lib/workspaces';
import {
  buildResolveConflictsPrompt,
  type ConflictScenario,
} from '@/lib/executor/prompts/resolve-conflicts';
import * as executor from '@/lib/executor/adapter';

/**
 * Resolve-conflicts surface for the execution view's action bar.
 *
 * Injects a "fetch, merge, resolve markers, commit, push" prompt into
 * the chat session. Two scenarios — `pr_vs_base` (GitHub reports the PR
 * as conflicting) and `local_vs_remote` (push rejected non-fast-forward).
 * The prompt branches on `scenario` but the post-merge work is the same.
 */

const BodySchema = z.object({
  scenario: z.enum(['pr_vs_base', 'local_vs_remote']),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const raw = await request.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: 'invalid_params', message: 'scenario must be "pr_vs_base" or "local_vs_remote"' },
        { status: 400 },
      );
    }
    const scenario: ConflictScenario = parsed.data.scenario;

    const session = getChatSession(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (session.status === 'archived') {
      return Response.json({ error: 'Cannot resolve conflicts on an archived session' }, { status: 400 });
    }
    if (executor.isRunning(id)) {
      return Response.json(
        { error: 'already_running', message: 'A turn is already in flight for this session.' },
        { status: 409 },
      );
    }
    if (!session.workspace_id || !session.worktree_path || !session.branch_name) {
      return Response.json(
        { error: 'no_worktree', message: 'No worktree or branch on this session.' },
        { status: 400 },
      );
    }

    const ws = getWorkspace(session.workspace_id);
    if (!ws) return Response.json({ error: 'Workspace not found' }, { status: 404 });

    if (scenario === 'pr_vs_base' && !ws.base_branch) {
      return Response.json(
        { error: 'no_base_branch', message: 'Workspace has no base branch configured.' },
        { status: 400 },
      );
    }

    const handle = await openWorktreeHandle(session, ws.cwd);
    if (!handle || handle.kind !== 'git') {
      return Response.json({ error: 'Worktree unavailable' }, { status: 404 });
    }

    const prompt = buildResolveConflictsPrompt({
      scenario,
      branch: session.branch_name,
      baseBranch: ws.base_branch ?? undefined,
    });

    insertChatEvent({
      session_id: id,
      role: 'user',
      source: 'user',
      content: prompt,
      created_at: new Date().toISOString(),
    });

    executor.dispatch(id, prompt).catch((err) => {
      console.error(`[POST /api/sessions/:id/resolve-conflicts] dispatch failed for ${id}:`, err);
    });

    return Response.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/sessions/:id/resolve-conflicts]', err);
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: name, message }, { status: 400 });
  }
}
