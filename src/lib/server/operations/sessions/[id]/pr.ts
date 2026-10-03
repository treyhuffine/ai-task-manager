import { getChatSessionWithExecution, getWorkspace, insertChatEvent } from '@/lib/db/queries';
import * as executor from '@/lib/executor/adapter';
import { executionDiff, executionFolder } from '@/lib/executor/owner-files';
import { githubAnswerOnOwner } from '@/lib/executor/owner-git';
import { buildOpenPrPrompt } from '@/lib/executor/prompts/open-pr';
import { answerResult, failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { prResponseSchema } from '@/lib/server/remote-contracts';
import { z as rpcZ } from 'zod/v4';

/**
 * PR surface for the execution view's action bar.
 *
 *   GET  — look up the PR for the session's branch via `@agentex/github`.
 *          Returns `null` when none exists.
 *   POST — inject a "draft a title/body and `gh pr create` …" prompt into
 *          the chat session. The agent's existing Bash tool runs the
 *          actual `gh pr create`. The prompt always includes a compact
 *          diff summary so the agent can write a meaningful title even
 *          when the user clicks Open PR without a prior turn.
 */

export type { PrInfo } from '@/lib/github/execution-github';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const session = getChatSessionWithExecution(id);
    if (!session) return reply({ error: 'Session not found' }, { status: 404 });
    // A branch is all a PR needs. Its worktree may be on another device.
    if (!session.workspaceId || !session.branchName) return reply({ pr: null });
    // Where a clone of its repository is: the agent's folder here, or on
    // the device the agent lives on (P4.5).
    return answerResult(await githubAnswerOnOwner(id, { op: 'pr', prNumber: session.prNumber, branchName: session.branchName }), prResponseSchema);
  } catch (err) {
    console.error('[GET /api/sessions/:id/pr]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const session = getChatSessionWithExecution(id);
    if (!session) return reply({ error: 'Session not found' }, { status: 404 });
    if (session.status === 'archived') {
      return reply({ error: 'Cannot open a PR on an archived session' }, { status: 400 });
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
    if (!ws.baseBranch) {
      return reply(
        { error: 'no_base_branch', message: 'Workspace has no base branch configured.' },
        { status: 400 },
      );
    }

    const read = await executionDiff(id);
    if (!read.ok) return failureResponse(read.response);
    const prompt = buildOpenPrPrompt({
      branch: session.branchName,
      baseBranch: ws.baseBranch,
      diff: read.diff as Parameters<typeof buildOpenPrPrompt>[0]['diff'],
    });

    // Persist the prompt as a user-role event so the transcript shows
    // exactly what the agent was asked to do — same pattern as a real
    // user-typed message. Mark `source: 'system'` so the transcript can
    // render it as an action-bar event rather than an organic user
    // message (the executor still dispatches it as the next turn).
    const event = insertChatEvent({
      sessionId: id,
      role: 'user',
      source: 'user',
      content: prompt,
      createdAt: new Date().toISOString(),
    });

    // Fire-and-forget dispatch into the executor. The agent's reply
    // (drafted title/body and `gh pr create` invocation) streams back
    // through the existing chat-event pipeline. Tied to its event, so it
    // reaches the harness once wherever the execution runs, and a move in
    // progress holds it (P4.5).
    executor.dispatch(id, prompt, { sourceEventId: event?.id ?? null }).catch((err) => {
      console.error(`[POST /api/sessions/:id/pr] dispatch failed for ${id}:`, err);
    });

    return reply({ ok: true });
  } catch (err) {
    console.error('[POST /api/sessions/:id/pr]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
