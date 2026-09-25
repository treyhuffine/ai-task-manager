/**
 * A worker's acknowledgement of a command (docs/homes-build.md, P2 protocol
 * and P2.3): delivered, failed, stale or uncertain. Sent only after the
 * worker journaled the command's outcome, and resent until the home confirms
 * it, so this is idempotent and answers with the state the home holds.
 *
 * A send that didn't reach its harness (failed, stale, or uncertain) never
 * produces a turn result, so its run is finished here, in the same
 * transaction as the acknowledgement (P2.4). A prepared execution records
 * its worktree on its placement and, when its agent has a setup script,
 * queues it as its own command. A setup script's outcome is recorded on the
 * execution.
 */

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  ackWorkerCommand,
  getWorkerCommand,
  markPlacementPrepared,
  queueWorkerCommand,
  recordExecutionSetupError,
  setExecutionSetupScript,
} from '@/lib/db/queries';
import type { WorkerCommandRecord } from '@/db/types';
import { wakeComputer } from '@/lib/workers/hub';
import type { PreparePayload, PrepareResult, SetupScriptPayload } from '@/lib/worker/handlers';
import { inTransaction } from '@/lib/effects/after-commit';
import { requireWorker } from '@/lib/workers/route-auth';
import { settleUndelivered } from '@/lib/workers/undelivered';

const body = z.object({
  state: z.enum(['delivered', 'failed', 'stale', 'uncertain']),
  result: z.unknown().optional(),
  error: z.string().max(4000).nullable().optional(),
});

function recordPrepared(command: WorkerCommandRecord, after: { tasks: Array<() => void> }): void {
  if (!command.executionId || command.generation === null) return;
  if (command.state !== 'delivered') {
    recordExecutionSetupError(command.executionId, command.error ?? 'The computer could not prepare this execution.');
    return;
  }
  const prepared = command.result as PrepareResult;
  const placement = markPlacementPrepared(command.executionId, command.generation, prepared);
  const { workspace } = command.payload as PreparePayload;
  if (!placement || !workspace.setupCommand?.trim() || prepared.worktreePath === workspace.cwd) return;
  const script: SetupScriptPayload = {
    script: 'setup',
    workspaceId: workspace.id,
    command: workspace.setupCommand,
    worktreePath: prepared.worktreePath,
    branchName: prepared.branchName,
  };
  queueWorkerCommand({
    computerId: command.computerId,
    kind: 'run_script',
    payload: script,
    actor: { source: 'system' },
    executionId: command.executionId,
    chatSessionId: command.chatSessionId,
    generation: command.generation,
  });
  setExecutionSetupScript(command.executionId, 'running', null);
  after.tasks.push(() => wakeComputer(command.computerId));
}

function recordSetupScript(command: WorkerCommandRecord): void {
  if (!command.executionId || (command.payload as { script?: string } | null)?.script !== 'setup') return;
  if (command.state === 'delivered') {
    const outcome = command.result as { ok: boolean; output: string };
    setExecutionSetupScript(command.executionId, outcome.ok ? 'done' : 'failed', outcome.ok ? null : outcome.output);
  } else {
    setExecutionSetupScript(command.executionId, 'failed', command.error ?? 'The setup script did not run.');
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const worker = requireWorker(request.headers);
  if (worker instanceof Response) return worker;
  const { id } = await params;
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: 'invalid_params', message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const ack = parsed.data;
  const command = inTransaction((after) => {
    const before = getWorkerCommand(id);
    const recorded = ackWorkerCommand(worker.computer.id, id, ack);
    if (!recorded || !before || before.state === recorded.state) return recorded;
    settleUndelivered(recorded, after);
    if (recorded.kind === 'prepare') recordPrepared(recorded, after);
    if (recorded.kind === 'run_script') recordSetupScript(recorded);
    return recorded;
  });
  if (!command) return Response.json({ error: 'not_found', message: 'This computer has no such command.' }, { status: 404 });
  return Response.json({ state: command.state });
}
