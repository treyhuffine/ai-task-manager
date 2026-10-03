import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { readAnswerOnOwner, writeAnswerOnOwner } from '@/lib/executor/owner-files';
import { answerResult, reply, type OperationContext } from '@/lib/server/operation';
import { wipApplySchema, wipDetectionSchema } from '@/lib/server/remote-contracts';
import { whileOperationAdmitted as whileAdmitted } from '@/lib/transfer/moving';
import {
  copyWipToWorktree,
  detectSourceWip,
  moveWipToWorktree,
} from '@/lib/workspaces/wip';
import { z as rpcZ } from 'zod/v4';

/**
 * Live WIP read for the session's source repo. Returns the current
 * state — counts may differ from when the worktree was provisioned if
 * the user has kept editing in the source repo since. That's intentional:
 * the banner asks about *what's there now*, not what was there at create
 * time.
 *
 * Returns `null` for non-git workspaces, sessions whose worktree hasn't
 * been provisioned yet, or Live / in-place sessions (worktreePath === cwd)
 * — the banner sits dormant in those cases. An in-place session edits the
 * source checkout directly, so there is no separate worktree for WIP to
 * "stay behind" from.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const session = getChatSessionWithExecution(id);
    if (!session) return reply({ error: 'Session not found' }, { status: 404 });
    // An execution on a connected device: its worker answers.
    const remote = await readAnswerOnOwner(id, { kind: 'wip' });
    if (remote) return answerResult(remote, wipDetectionSchema.nullable());
    if (!session.worktreePath || !session.workspaceId) {
      return reply(null);
    }
    const ws = getWorkspace(session.workspaceId);
    if (!ws || !ws.isGit) return reply(null);
    if (session.worktreePath === ws.cwd) return reply(null);

    const wip = await detectSourceWip(ws.cwd, ws.filesToCopy ?? []);
    return reply(wip);
  } catch (err) {
    console.error('[GET /api/sessions/:id/wip]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

interface PostBody {
  action: 'copy' | 'move';
}

/**
 * Apply a WIP handoff. Re-detects the source repo's current WIP — we
 * don't trust a client-supplied file list because the source could have
 * changed since the banner rendered. Then copies or stashes+pops.
 *
 * Response shapes:
 *   - copy:  { action: 'copy', copied: string[], skipped: {...}[] }
 *   - move:  { action: 'move', conflict: boolean, stashMessage: string | null }
 */
async function handlePOST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const body = (rpcInput.body) as PostBody;
    if (body.action !== 'copy' && body.action !== 'move') {
      return reply(
        { error: `Invalid action. Expected 'copy' or 'move'.` },
        { status: 400 },
      );
    }

    // Elsewhere, the agent's folder and the worktree are both on that device.
    const owner = await writeAnswerOnOwner(id, { kind: 'bring_wip', action: body.action });
    if (owner) return answerResult(owner, wipApplySchema);

    const session = getChatSessionWithExecution(id);
    if (!session) return reply({ error: 'Session not found' }, { status: 404 });
    if (!session.worktreePath || !session.workspaceId) {
      return reply({ error: 'Worktree not provisioned yet' }, { status: 409 });
    }
    const ws = getWorkspace(session.workspaceId);
    if (!ws || !ws.isGit) {
      return reply({ error: 'Workspace is not a git workspace' }, { status: 409 });
    }
    if (session.worktreePath === ws.cwd) {
      // In-place session: the source checkout IS the worktree, so there is
      // nothing to copy or stash across.
      return reply(
        { error: 'Session runs in-place; no worktree handoff needed' },
        { status: 409 },
      );
    }

    const wip = await detectSourceWip(ws.cwd, ws.filesToCopy ?? []);
    const allFiles = [...wip.modified, ...wip.untracked];
    if (allFiles.length === 0) {
      return reply({ action: body.action, empty: true });
    }

    if (body.action === 'copy') {
      const result = await copyWipToWorktree({
        sourceCwd: ws.cwd,
        worktreePath: session.worktreePath,
        files: allFiles,
      });
      return reply({ action: 'copy', ...result });
    }

    const result = await moveWipToWorktree({
      sourceCwd: ws.cwd,
      worktreePath: session.worktreePath,
      files: allFiles,
    });
    return reply({ action: 'move', ...result });
  } catch (err) {
    console.error('[POST /api/sessions/:id/wip]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

/** A change to its files, counted while it runs: never under a move (P4 review). */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  const { id } = rpcInput.params;
  return whileAdmitted(id, 'changing its files', () => handlePOST(rpcInput, request));
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "action": rpcZ.enum(["copy", "move"]) }).strict() }).strict();
