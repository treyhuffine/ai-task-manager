import { answerResult, reply, type OperationContext } from '@/lib/server/operation';
import { workingStateSchema } from '@/lib/server/remote-contracts';
import { z as rpcZ } from 'zod/v4';
/**
 * What a move would take from the execution's worktree, read where it runs
 * (P4.2): the tracked changes that always go, the untracked files the person
 * can choose to include, and the local setup and secrets that stay behind.
 */

import { getChatSessionWithExecution, getWorkspace, placementOf } from '@/lib/db/queries';
import { readAnswerOnOwner } from '@/lib/executor/owner-files';
import { workingState } from '@/lib/transfer/git-checkpoint';
import fs from 'node:fs';

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  const remote = await readAnswerOnOwner(id, { kind: 'working_state' });
  if (remote) return answerResult(remote, workingStateSchema.nullable());
  const session = getChatSessionWithExecution(id);
  const ws = session?.workspaceId ? getWorkspace(session.workspaceId) : null;
  if (!session?.executionId || !ws) return reply({ error: 'Session not found' }, { status: 404 });
  if (!ws.isGit) return reply(null);
  const worktree = placementOf(session.executionId)?.worktreePath ?? session.worktreePath;
  if (!worktree || !fs.existsSync(worktree)) return reply({ error: 'Worktree unavailable' }, { status: 404 });
  return reply(await workingState(worktree, ws.filesToCopy ?? []));
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
