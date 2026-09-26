import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, getWorkspace, insertChatEvent } from '@/lib/db/queries';
import { buildCommitPrompt } from '@/lib/executor/prompts/commit';
import * as executor from '@/lib/executor/adapter';
import { executionDiff, executionFolder } from '@/lib/executor/owner-files';

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
    // Its worktree wherever it runs (P4.5).
    if (!session.workspaceId || !executionFolder(id) || !session.branchName) {
      return Response.json(
        { error: 'noWorktree', message: 'No worktree or branch on this session.' },
        { status: 400 },
      );
    }

    const ws = getWorkspace(session.workspaceId);
    if (!ws) return Response.json({ error: 'Workspace not found' }, { status: 404 });
    if (!ws.isGit) return Response.json({ error: 'Not a git workspace' }, { status: 400 });

    // Diff against the workspace's base sha — superset of the
    // uncommitted changes (also includes already-committed work on this
    // branch). Agent runs `git status` + `git diff` itself before
    // composing the message; the summary just anchors the scope. Read
    // where the worktree is.
    const read = await executionDiff(id);
    if (!read.ok) return read.response;
    const prompt = buildCommitPrompt({
      branch: session.branchName,
      diff: read.diff as Parameters<typeof buildCommitPrompt>[0]['diff'],
      andPush,
    });

    const event = insertChatEvent({
      sessionId: id,
      role: 'user',
      source: 'user',
      content: prompt,
      createdAt: new Date().toISOString(),
    });

    // Tied to its event: it reaches the harness once wherever the execution
    // runs, and a move in progress holds it (P4.5).
    executor.dispatch(id, prompt, { sourceEventId: event?.id ?? null }).catch((err) => {
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
