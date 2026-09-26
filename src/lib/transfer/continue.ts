/**
 * Continue here (docs/homes-spec.md §8.2 and §8.3, P4.2 to P4.4): move an
 * execution to another computer. The same Ri execution, chat history, task
 * links and agent. Its computer, working folder and harness session change.
 *
 * The home runs every transfer, whichever computers it moves between:
 *
 *   1. Check both computers can take part, and take the transfer's lock.
 *      From here, messages sent to the execution are held.
 *   2. Stopping: the source stops everything the execution runs there, and
 *      confirms it (harness, background tasks, terminals, preview), and its
 *      last events reach the home. That is the conversation checkpoint.
 *   3. Saving work: a Git checkpoint on the source, pushed without force.
 *   4. Setting up: the destination fetches that exact commit, builds its
 *      worktree, copies its local files and runs the setup script.
 *   5. Continuing: in one transaction the destination takes the next
 *      generation. "Continued on MacBook" goes in the chat, the destination
 *      starts a fresh session from the handoff, and held messages go there
 *      once.
 *
 * A step that fails stops the transfer there, saying where and why. Before
 * ownership changes, the source keeps the work, stopped, and can resume or
 * try again. After, the destination has it. Held messages, the source's
 * worktree, the pushed branch and the destination's worktree are all kept.
 */

import path from 'node:path';
import fs from 'node:fs';
import type { ExecutionTransferRecord, TransferStage, WorkerCommandActor } from '@/db/types';
import {
  continueOwnership,
  createTransfer,
  getChatEventById,
  getChatSessionWithExecution,
  getComputer,
  getExecution,
  getHome,
  getTransfer,
  getWorkerCommand,
  getWorkspace,
  insertChatEvent,
  latestChatEventForExecution,
  latestTransfer,
  listAgentSetups,
  listChatEvents,
  listEnrolledComputerIds,
  listExecutionChatIds,
  placementOf,
  previousWorktreeOn,
  queueWorkerCommand,
  TransferConflictError,
  updateTransfer,
} from '@/lib/db/queries';
import { isComputerConnected, wakeComputer } from '@/lib/workers/hub';
import { publishTransfer } from '@/lib/realtime/bus';
import { runOnFor } from '@/lib/setups/run-on';
import { saveCheckpoint, worktreeAtCheckpoint, type SavedCheckpoint } from './git-checkpoint';
import { composeHandoff, deterministicHandoff, summaryPrompt, type HandoffInput } from './handoff';
import { transferView, type TransferView } from './view';
import type { PreparePayload, GitPayload, QuiescePayload, SetupScriptPayload, PrepareResult } from '@/lib/worker/handlers';

export class TransferError extends Error {
  constructor(
    readonly code:
      | 'not_found'
      | 'archived'
      | 'not_git'
      | 'same_computer'
      | 'not_here'
      | 'destination_not_ready'
      | 'source_unreachable'
      | 'destination_unreachable'
      | 'conflict'
      | 'nothing_held',
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = 'TransferError';
  }
}

/** How long each step on a connected computer may take before the transfer stops there. */
export const STEP_TIMEOUTS_MS = {
  quiesce: 2 * 60_000,
  checkpoint: 3 * 60_000,
  prepare: 10 * 60_000,
  setup: 16 * 60_000,
};

export function computerName(computerId: string): string {
  return getComputer(computerId)?.name ?? 'another computer';
}

export function viewOf(transfer: ExecutionTransferRecord): TransferView {
  return transferView(transfer, computerName);
}

function announce(transfer: ExecutionTransferRecord): void {
  publishTransfer(listExecutionChatIds(transfer.executionId), viewOf(transfer));
}

/** Why the work can't move to this computer now, or null when it can. */
function destinationProblem(workspaceId: string, harness: string, toComputerId: string): string | null {
  const host = getHome()?.hostComputerId ?? null;
  const name = computerName(toComputerId);
  const computer = getComputer(toComputerId);
  if (!computer || computer.status !== 'active') return `${name} is no longer connected to this home.`;
  const choice = runOnFor(workspaceId)?.choices.find((c) => c.computerId === toComputerId);
  if (!choice) return `${getWorkspace(workspaceId)?.name ?? 'The agent'} isn't set up on ${name}. Attach its folder there first.`;
  if (!choice.ready) return choice.problem ?? `${name} can't take this work yet.`;
  if (toComputerId === host) return null;
  if (!listEnrolledComputerIds().has(toComputerId)) return `${name} isn't set up to run agents. Run \`ri worker enroll\` there first.`;
  if (!isComputerConnected(toComputerId)) return `${name} isn't connected. Start Ri's worker there, then continue.`;
  const report = computer.harnesses?.find((h) => h.harness === harness);
  if (report && report.binary.status !== 'supported') return `${name} can't run ${harness} right now.`;
  return null;
}

export interface StartTransferInput {
  /** The chat it was asked from: "Continued on MacBook" is recorded there. */
  chatSessionId: string;
  toComputerId: string;
  includeUntracked: string[];
  requestedByApiKeyId: string | null;
  actor?: WorkerCommandActor;
}

/**
 * Check the move can start, take the lock, and run it. Returns as soon as
 * the lock is held: progress is published as it goes.
 */
export function startTransfer(input: StartTransferInput): ExecutionTransferRecord {
  const session = getChatSessionWithExecution(input.chatSessionId);
  if (!session?.executionId || !session.workspaceId) throw new TransferError('not_found', 'Only an execution can move.', 404);
  const execution = getExecution(session.executionId);
  const workspace = getWorkspace(session.workspaceId);
  if (!execution || !workspace) throw new TransferError('not_found', 'Execution not found.', 404);
  if (execution.status === 'archived') throw new TransferError('archived', 'An archived execution stays where it was.');
  if (!workspace.isGit) {
    throw new TransferError('not_git', "Work that isn't in a Git repository runs on its own computer, and doesn't move through Ri yet.");
  }
  const placement = placementOf(execution.id);
  if (!placement) throw new TransferError('not_found', 'This home has no computer yet.');
  if (placement.computerId === input.toComputerId) throw new TransferError('same_computer', `It already runs on ${computerName(input.toComputerId)}.`);
  const host = getHome()?.hostComputerId ?? null;
  if (placement.computerId !== host && !isComputerConnected(placement.computerId)) {
    throw new TransferError(
      'source_unreachable',
      `${computerName(placement.computerId)} isn't connected, so its work can't be saved and moved. Wait for it, or keep following it here.`,
    );
  }
  const problem = destinationProblem(workspace.id, session.harness, input.toComputerId);
  if (problem) throw new TransferError('destination_not_ready', problem);

  // A transfer that stopped earlier still holds messages: they come along.
  const earlier = latestTransfer(execution.id);
  const carried = earlier?.state === 'failed' && earlier.toGeneration === null ? earlier.heldEventIds : [];
  let transfer: ExecutionTransferRecord;
  try {
    transfer = createTransfer({
      executionId: execution.id,
      fromComputerId: placement.computerId,
      toComputerId: input.toComputerId,
      fromGeneration: placement.generation,
      includeUntracked: input.includeUntracked,
      heldEventIds: carried,
      requestedByApiKeyId: input.requestedByApiKeyId,
    });
  } catch (err) {
    if (err instanceof TransferConflictError) throw new TransferError('conflict', err.message);
    throw err;
  }
  if (earlier && carried.length > 0) updateTransfer(earlier.id, { heldEventIds: [] });
  announce(transfer);
  void runTransfer(transfer.id, input).catch((err) => console.error(`[transfer] ${transfer.id} failed unexpectedly:`, err));
  return transfer;
}

class StepFailed extends Error {}

/** Wait for a command to reach a final state. Its result when delivered, or the step fails with its reason. */
async function awaitCommand(commandId: string, timeoutMs: number, what: string): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const command = getWorkerCommand(commandId);
    if (!command) throw new StepFailed(`${what} was lost.`);
    if (command.state === 'delivered') return command.result;
    if (command.state === 'failed' || command.state === 'stale' || command.state === 'cancelled' || command.state === 'uncertain') {
      throw new StepFailed(command.error ?? `${what} didn't finish.`);
    }
    if (Date.now() > deadline) throw new StepFailed(`${what} didn't finish in time on ${computerName(command.computerId)}.`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

function queueOn(computerId: string, kind: 'quiesce' | 'git' | 'prepare' | 'run_script', payload: unknown, transfer: ExecutionTransferRecord, generation: number, chatSessionId: string | null, actor?: WorkerCommandActor) {
  const command = queueWorkerCommand({
    computerId,
    kind,
    payload,
    actor: actor ?? { source: 'system' },
    executionId: transfer.executionId,
    chatSessionId,
    generation,
  });
  wakeComputer(computerId);
  return command;
}

async function stopSource(transfer: ExecutionTransferRecord, chats: string[], actor?: WorkerCommandActor): Promise<void> {
  const host = getHome()?.hostComputerId ?? null;
  if (transfer.fromComputerId !== host) {
    const payload: QuiescePayload = { chatSessionIds: chats, transferId: transfer.id };
    const command = queueOn(transfer.fromComputerId, 'quiesce', payload, transfer, transfer.fromGeneration, chats[0] ?? null, actor);
    await awaitCommand(command.id, STEP_TIMEOUTS_MS.quiesce, `Stopping it on ${computerName(transfer.fromComputerId)}`);
    return;
  }
  // Here: the harness closed and confirmed gone, with its background tasks,
  // the execution's terminals, and its preview.
  const execution = getExecution(transfer.executionId);
  if (execution?.setupScriptStatus === 'running') {
    throw new StepFailed(`Its setup script is still running on ${computerName(host)}. Continue once it has finished.`);
  }
  const executor = await import('@/lib/executor/adapter');
  const live = await import('@/lib/executor/live-state');
  const problems: string[] = [];
  for (const chat of chats) {
    const report = await executor.close(chat, actor);
    if (!report.closed && report.error) problems.push(report.error);
    if (live.isRunning(chat) || live.hasBackgroundTasks(chat)) problems.push('A session is still running.');
  }
  const { killAllForOwner } = await import('@/lib/terminal/pty-manager');
  killAllForOwner(transfer.executionId);
  const { stopPreview } = await import('@/lib/preview/service');
  await stopPreview(transfer.executionId);
  if (problems.length > 0) throw new StepFailed(`It couldn't be stopped here: ${[...new Set(problems)].join(' ')}`);
}

async function saveOnSource(transfer: ExecutionTransferRecord, actor?: WorkerCommandActor): Promise<SavedCheckpoint> {
  const execution = getExecution(transfer.executionId)!;
  const workspace = getWorkspace(execution.workspaceId)!;
  const message = `Checkpoint: continuing on ${computerName(transfer.toComputerId)}`;
  const host = getHome()?.hostComputerId ?? null;
  if (transfer.fromComputerId !== host) {
    const payload: GitPayload = {
      op: 'checkpoint',
      message,
      includeUntracked: transfer.includeUntracked,
      filesToCopy: workspace.filesToCopy ?? [],
      transferId: transfer.id,
    };
    const command = queueOn(transfer.fromComputerId, 'git', payload, transfer, transfer.fromGeneration, null, actor);
    return (await awaitCommand(command.id, STEP_TIMEOUTS_MS.checkpoint, `Saving the work on ${computerName(transfer.fromComputerId)}`)) as SavedCheckpoint;
  }
  const worktree = placementOf(execution.id)?.worktreePath ?? execution.worktreePath;
  if (!worktree || !fs.existsSync(worktree)) throw new StepFailed("Its worktree isn't on this computer.");
  return saveCheckpoint({ worktree, message, includeUntracked: transfer.includeUntracked, filesToCopy: workspace.filesToCopy ?? [] });
}

/** The folder this home keeps an agent in: its setup here, or its folder from before setups. */
function homeAgentFolder(workspaceId: string): string | null {
  const host = getHome()?.hostComputerId ?? null;
  const setup = host ? listAgentSetups({ workspaceId }).find((s) => s.computerId === host) : undefined;
  return setup?.sourcePath ?? getWorkspace(workspaceId)?.cwd ?? null;
}

async function prepareDestination(
  transfer: ExecutionTransferRecord,
  checkpoint: SavedCheckpoint,
  chatSessionId: string,
  actor?: WorkerCommandActor,
): Promise<string> {
  const execution = getExecution(transfer.executionId)!;
  const workspace = getWorkspace(execution.workspaceId)!;
  const generation = transfer.fromGeneration + 1;
  const host = getHome()?.hostComputerId ?? null;
  const to = computerName(transfer.toComputerId);
  const setup = workspace.setupCommand?.trim() || null;

  if (transfer.toComputerId !== host) {
    const payload: PreparePayload = {
      workspace,
      chatSessionId,
      label: execution.label ?? null,
      baseBranch: workspace.baseBranch,
      prNumber: null,
      live: false,
      transfer: { id: transfer.id, checkpoint: { remote: checkpoint.remote, branch: checkpoint.branch, sha: checkpoint.sha } },
    };
    const command = queueOn(transfer.toComputerId, 'prepare', payload, transfer, generation, chatSessionId, actor);
    const prepared = (await awaitCommand(command.id, STEP_TIMEOUTS_MS.prepare, `Setting up ${to}`)) as PrepareResult;
    updateTransfer(transfer.id, { targetWorktreePath: prepared.worktreePath });
    if (setup) {
      const script: SetupScriptPayload & { transferId: string } = {
        script: 'setup',
        workspaceId: workspace.id,
        command: setup,
        worktreePath: prepared.worktreePath,
        branchName: prepared.branchName,
        transferId: transfer.id,
      };
      const run = queueOn(transfer.toComputerId, 'run_script', script, transfer, generation, chatSessionId, actor);
      const outcome = (await awaitCommand(run.id, STEP_TIMEOUTS_MS.setup, `The setup script on ${to}`)) as { ok: boolean; output: string };
      if (!outcome.ok) throw new StepFailed(`The setup script failed on ${to}:\n${outcome.output}`);
    }
    return prepared.worktreePath;
  }

  // Here.
  const repo = homeAgentFolder(workspace.id);
  if (!repo || !fs.existsSync(repo)) throw new StepFailed(`${workspace.name}'s folder isn't on ${to}.`);
  const before = previousWorktreeOn(execution.id, transfer.toComputerId);
  const earlier = before && before !== repo ? before : null;
  const { buildWorktreeLeaf, defaultWorktreeRoot, runWorktreeScript } = await import('@/lib/workspaces/index');
  const target = earlier ?? path.join(workspace.worktreeRoot ?? defaultWorktreeRoot(workspace.slug), buildWorktreeLeaf(workspace.slug, chatSessionId));
  const made = await worktreeAtCheckpoint({ repo, path: target, checkpoint });
  updateTransfer(transfer.id, { targetWorktreePath: made.path });
  const { copyFilesToWorktree } = await import('@/lib/workspaces/files-to-copy');
  await copyFilesToWorktree(repo, made.path, workspace.filesToCopy ?? []);
  if (setup) {
    const outcome = await runWorktreeScript({ command: setup, worktreePath: made.path, sourceCheckoutPath: repo, branch: made.branch });
    if (!outcome.ok) throw new StepFailed(`The setup script failed on ${to}:\n${outcome.output}`);
  }
  return made.path;
}

async function writeHandoff(transfer: ExecutionTransferRecord, checkpoint: SavedCheckpoint, target: string, chats: string[]): Promise<string> {
  const execution = getExecution(transfer.executionId)!;
  const workspace = getWorkspace(execution.workspaceId)!;
  const messages = chats
    .flatMap((chat) => listChatEvents(chat, { limit: 60 }))
    .sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt)));
  const input: HandoffInput = {
    executionLabel: execution.label ?? null,
    agentName: workspace.name,
    fromComputer: computerName(transfer.fromComputerId),
    toComputer: computerName(transfer.toComputerId),
    checkpoint: { branch: checkpoint.branch, sha: checkpoint.sha, files: checkpoint.files },
    messages,
    chatSessionIds: chats,
    targetWorktree: target,
  };
  const fixed = deterministicHandoff(input);
  let summary: string | null = null;
  try {
    const { runHarnessText } = await import('@/lib/harness/one-shot');
    summary = (await runHarnessText({ label: 'continuation-handoff', prompt: summaryPrompt(input), tier: 'fast', timeoutSec: 45 })).text;
  } catch (err) {
    // The deterministic handoff is the contract. A summary only adds to it.
    console.warn(`[transfer] ${transfer.id}: no summary for the handoff (${err instanceof Error ? err.message : String(err)}).`);
  }
  return composeHandoff(fixed, summary);
}

/** Deliver the messages a transfer holds, in order, to wherever the work is now. Each goes once. */
export async function deliverHeld(transfer: ExecutionTransferRecord, actor?: WorkerCommandActor): Promise<void> {
  const { redispatchStoredMessage } = await import('@/lib/sessions/redispatch');
  const pending = [...transfer.heldEventIds];
  for (const eventId of pending) {
    const current = getTransfer(transfer.id);
    if (!current) return;
    updateTransfer(transfer.id, { heldEventIds: current.heldEventIds.filter((id) => id !== eventId) });
    try {
      await redispatchStoredMessage(eventId, actor);
    } catch (err) {
      // It went out and failed there: its own delivery state says so, with Send again.
      console.warn(`[transfer] held message ${eventId} failed to deliver:`, err);
    }
  }
}

async function runTransfer(transferId: string, input: StartTransferInput): Promise<void> {
  let transfer = getTransfer(transferId)!;
  let stage: TransferStage = transfer.stage;
  const chats = listExecutionChatIds(transfer.executionId);
  const move = (next: TransferStage) => {
    stage = next;
    transfer = updateTransfer(transfer.id, { stage: next })!;
    announce(transfer);
  };
  try {
    move('stopping');
    await stopSource(transfer, chats, input.actor);
    transfer = updateTransfer(transfer.id, { conversationCheckpointEventId: latestChatEventForExecution(transfer.executionId) })!;

    move('saving');
    const checkpoint = await saveOnSource(transfer, input.actor);
    transfer = updateTransfer(transfer.id, { branch: checkpoint.branch, remote: checkpoint.remote, checkpointSha: checkpoint.sha })!;

    move('setting_up');
    const target = await prepareDestination(transfer, checkpoint, input.chatSessionId, input.actor);
    const handoff = await writeHandoff(transfer, checkpoint, target, chats);
    transfer = updateTransfer(transfer.id, { handoff })!;

    // Ownership changes here, and only here.
    stage = 'continuing';
    transfer = continueOwnership({ transferId: transfer.id, worktreePath: target, checkpointSha: checkpoint.sha, branch: checkpoint.branch }).transfer;
    announce(transfer);
    insertChatEvent({
      sessionId: chats.includes(input.chatSessionId) ? input.chatSessionId : chats[chats.length - 1],
      role: 'system',
      source: 'continuation',
      content: `Continued on ${computerName(transfer.toComputerId)}`,
      raw: {
        transferId: transfer.id,
        from: computerName(transfer.fromComputerId),
        to: computerName(transfer.toComputerId),
        checkpoint: { branch: checkpoint.branch, sha: checkpoint.sha },
        handoff,
      },
      createdAt: new Date().toISOString(),
    });
    await deliverHeld(transfer, input.actor);
    transfer = updateTransfer(transfer.id, { stage: 'done', state: 'succeeded', finishedAt: new Date().toISOString() })!;
    announce(transfer);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    transfer = updateTransfer(transfer.id, { state: 'failed', failedStage: stage, error: message, finishedAt: new Date().toISOString() })!;
    announce(transfer);
  }
}

/**
 * After a transfer stopped before ownership changed: the source keeps the
 * work, and the messages it held go there (§8.3). Nothing else was undone:
 * the pushed branch and any destination worktree stay.
 */
export async function resumeOnSource(executionId: string, actor?: WorkerCommandActor): Promise<ExecutionTransferRecord> {
  const transfer = latestTransfer(executionId);
  if (!transfer || transfer.state !== 'failed' || transfer.toGeneration !== null) {
    throw new TransferError('nothing_held', 'There is no stopped move to resume from.');
  }
  await deliverHeld(transfer, actor);
  const updated = getTransfer(transfer.id)!;
  announce(updated);
  return updated;
}

/** After a transfer stopped once the destination owned the work: deliver what it still holds, there. */
export async function finishOnDestination(executionId: string, actor?: WorkerCommandActor): Promise<ExecutionTransferRecord> {
  const transfer = latestTransfer(executionId);
  if (!transfer || transfer.state !== 'failed' || transfer.toGeneration === null) {
    throw new TransferError('nothing_held', 'There is no stopped move to finish.');
  }
  await deliverHeld(transfer, actor);
  const updated = updateTransfer(transfer.id, { state: 'succeeded', stage: 'done', error: null, failedStage: null, finishedAt: new Date().toISOString() })!;
  announce(updated);
  return updated;
}

/** The handoff a fresh session on the destination starts from, while none has started yet (P4.3). */
export function pendingHandoff(executionId: string, externalSessionId: string | null): string | null {
  if (externalSessionId) return null;
  const transfer = latestTransfer(executionId);
  if (!transfer?.handoff || transfer.toGeneration === null) return null;
  const placement = placementOf(executionId);
  if (!placement || placement.generation !== transfer.toGeneration) return null;
  return transfer.handoff;
}

/** A held message's event, for its delivery line. */
export function heldEvent(eventId: string) {
  return getChatEventById(eventId);
}
