import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, getWorkspace, insertChatEvent } from '@/lib/db/queries';
import { openWorktreeHandle } from '@/lib/workspaces';
import { buildCommitPrompt } from '@/lib/executor/prompts/commit';
import * as executor from '@/lib/executor/adapter';

/**
 * Commit surface for the execution view's action bar.
 *
 * Injects a "commit these changes with a focused message; optionally
 * push" prompt into the chat session. The agent reads the diff, drafts
 * its own commit message, and runs `git commit` (and `git push` when
 * `andPush`) via its Bash tool. Mirrors the `/pr` route's pattern —
 * intelligence belongs in the agent, the route just stages the prompt.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: { andPush?: boolean } = await request.json().catch(() => ({}));
    const andPush = body.andPush ?? false;

    const session = getChatSessionWithExecution(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (session.status === 'archived') {
      return Response.json({ error: 'Cannot commit on an archived session' }, { status: 400 });
    }
    if (executor.isRunning(id)) {
      return Response.json(
        { error: 'already_running', message: 'A turn is already in flight for this session.' },
        { status: 409 },
      );
    }
    if (!session.workspaceId || !session.worktreePath || !session.branchName) {
      return Response.json(
        { error: 'noWorktree', message: 'No worktree or branch on this session.' },
        { status: 400 },
      );
    }

    const ws = getWorkspace(session.workspaceId);
    if (!ws) return Response.json({ error: 'Workspace not found' }, { status: 404 });

    const handle = await openWorktreeHandle(session, ws.cwd);
    if (!handle || handle.kind !== 'git') {
      return Response.json({ error: 'Not a git workspace' }, { status: 400 });
    }

    // Diff against the workspace's base sha — superset of the
    // uncommitted changes (also includes already-committed work on this
    // branch). Agent runs `git status` + `git diff` itself before
    // composing the message; the summary just anchors the scope.
    const diff = await handle.git.diff('base');
    const prompt = buildCommitPrompt({
      branch: session.branchName,
      diff,
      andPush,
    });

    insertChatEvent({
      sessionId: id,
      role: 'user',
      source: 'user',
      content: prompt,
      createdAt: new Date().toISOString(),
    });

    executor.dispatch(id, prompt).catch((err) => {
      console.error(`[POST /api/sessions/:id/commit] dispatch failed for ${id}:`, err);
    });

    return Response.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/sessions/:id/commit]', err);
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: name, message }, { status: 400 });
  }
}
