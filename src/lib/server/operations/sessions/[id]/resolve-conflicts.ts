import { getRequestKey } from '@/lib/auth/request-key';
import { sessionAuthority, executionOperationFailure } from '@/lib/workspaces/access';
import { submitActionMessage, replayActionMessage } from '@/lib/sessions/action-message';
import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import * as executor from '@/lib/executor/adapter';
import { executionFolder } from '@/lib/executor/owner-files';
import {
  buildResolveConflictsPrompt,
  type ConflictScenario,
} from '@/lib/executor/prompts/resolve-conflicts';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z } from 'zod';
import { z as rpcZ } from 'zod/v4';

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

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const { requestId, ...actionInput } = rpcInput.body;
    const intent = { action: 'resolve-conflicts', input: actionInput };
    const replay = replayActionMessage(request.headers, id, requestId, intent);
    if (replay) return reply({ ok: true, ...replay });
    sessionAuthority(getRequestKey(request.headers), id, 'send');
    const raw = rpcInput.body;
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return reply(
        { error: 'invalid_params', message: 'scenario must be "pr_vs_base" or "local_vs_remote"' },
        { status: 400 },
      );
    }
    const scenario: ConflictScenario = parsed.data.scenario;

    const session = getChatSessionWithExecution(id);
    if (!session) return reply({ error: 'Session not found' }, { status: 404 });
    if (session.status === 'archived') {
      return reply({ error: 'Cannot resolve conflicts on an archived session' }, { status: 400 });
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

    if (scenario === 'pr_vs_base' && !ws.baseBranch) {
      return reply(
        { error: 'no_base_branch', message: 'Workspace has no base branch configured.' },
        { status: 400 },
      );
    }

    if (!ws.isGit) return reply({ error: 'Worktree unavailable' }, { status: 404 });

    const prompt = buildResolveConflictsPrompt({
      scenario,
      branch: session.branchName,
      baseBranch: ws.baseBranch ?? undefined,
    });

    const receipt = await submitActionMessage(request.headers, id, prompt, requestId, intent);

    return reply({ ok: true, ...receipt });
  } catch (err) {
    const denied = executionOperationFailure(err);
    if (denied) return denied;
    console.error('[POST /api/sessions/:id/resolve-conflicts]', err);
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    return reply({ error: name, message }, { status: 400 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "requestId": rpcZ.string().uuid().optional(), "scenario": rpcZ.enum(["pr_vs_base", "local_vs_remote"]) }).strict() }).strict();
