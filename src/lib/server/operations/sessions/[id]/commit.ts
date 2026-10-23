import { getRequestKey } from '@/lib/auth/request-key';
import { sessionAuthority, executionOperationFailure } from '@/lib/workspaces/access';
import { submitActionMessage, replayActionMessage } from '@/lib/sessions/action-message';
import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import * as executor from '@/lib/executor/adapter';
import { executionDiff, executionFolder } from '@/lib/executor/owner-files';
import { buildCommitPrompt } from '@/lib/executor/prompts/commit';
import { failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Commit surface for the execution view's action bar.
 *
 * Injects a "commit these changes with a focused message; optionally
 * push" prompt into the chat session. The agent reads the diff, drafts
 * its own commit message, and runs `git commit` (and `git push` when
 * `andPush`) via its Bash tool. Mirrors the `/pr` route's pattern —
 * intelligence belongs in the agent, the route just stages the prompt.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const { requestId, ...actionInput } = rpcInput.body;
    const intent = { action: 'commit', input: actionInput };
    const replay = replayActionMessage(request.headers, id, requestId, intent);
    if (replay) return reply({ ok: true, ...replay });
    sessionAuthority(getRequestKey(request.headers), id, 'send');
    const body: { andPush?: boolean } = rpcInput.body;
    const andPush = body.andPush ?? false;

    const session = getChatSessionWithExecution(id);
    if (!session) return reply({ error: 'Session not found' }, { status: 404 });
    if (session.status === 'archived') {
      return reply({ error: 'Cannot commit on an archived session' }, { status: 400 });
    }
    if (executor.isRunning(id)) {
      return reply(
        { error: 'already_running', message: 'A turn is already in flight for this session.' },
        { status: 409 },
      );
    }
    // Its worktree wherever it runs (P4.5).
    if (!session.workspaceId || !executionFolder(id) || !session.branchName) {
      return reply(
        { error: 'noWorktree', message: 'No worktree or branch on this session.' },
        { status: 400 },
      );
    }

    const ws = getWorkspace(session.workspaceId);
    if (!ws) return reply({ error: 'Workspace not found' }, { status: 404 });
    if (!ws.isGit) return reply({ error: 'Not a git workspace' }, { status: 400 });

    // Diff against the workspace's base sha — superset of the
    // uncommitted changes (also includes already-committed work on this
    // branch). Agent runs `git status` + `git diff` itself before
    // composing the message; the summary just anchors the scope. Read
    // where the worktree is.
    const read = await executionDiff(id);
    if (!read.ok) return failureResponse(read.response);
    const prompt = buildCommitPrompt({
      branch: session.branchName,
      diff: read.diff as Parameters<typeof buildCommitPrompt>[0]['diff'],
      andPush,
    });

    const receipt = await submitActionMessage(request.headers, id, prompt, requestId, intent);

    return reply({ ok: true, ...receipt });
  } catch (err) {
    const denied = executionOperationFailure(err);
    if (denied) return denied;
    console.error('[POST /api/sessions/:id/commit]', err);
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    return reply({ error: name, message }, { status: 400 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "requestId": rpcZ.string().uuid().optional(), "andPush": rpcZ.boolean().optional() }).strict().default({}) }).strict();
