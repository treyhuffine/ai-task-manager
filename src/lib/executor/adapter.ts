/**
 * The home's executor API (docs/homes-build.md, "P2.1 The runner split").
 *
 * Harness sessions and their live state belong to a runner
 * (`src/lib/runner/`), which never reads the database. This module is the
 * home's side: it checks a send (selection, budget, concurrency), creates
 * the run, builds the session spec when the runner needs one, sends through
 * the runner that holds the chat (`runnerFor`), and waits for the turn. The
 * runner reports everything back through the home sink (`home-sink.ts`),
 * which writes the chat events, publishes live state and finishes runs.
 *
 * The exports are the ones this module always had, so routes, the scheduler
 * and tests call the same functions. The live-state readers and test seams
 * are the local runner's, re-exported.
 */

import { existsSync } from 'node:fs';
import { uuidv7 } from 'uuidv7';
import type { StreamEvent, UserInputResponse } from '@agentex/agent';
import {
  chatPlacement,
  type ChatPlacement,
  getChatSessionWithExecution,
  getSendForEvent,
  getWorkspace,
  getUserState,
  updateChatSession,
  updateUserState,
  listChatSessions,
  listMainChats,
  createRun as createRunRow,
  markRunStarted as markRunStartedRow,
} from '@/lib/db/queries';
import { getAppRoot } from '@/lib/config/paths';
import type { Attachment, PermissionMode, WorkerCommandActor } from '@/db/types';
import { budgetGate } from '@/lib/runs/budget';
import { beginRun } from '@/lib/runs/artifact-bucket';
import { finishRun } from '@/lib/runs/finish';
import { explicitHarnessSelection, type ProviderId } from '@/lib/harness/options';
import { getHarnessModelCatalog } from '@/lib/harness/model-discovery';
import { isHarnessEnabled } from '@/lib/harness/registry';
import { ExecutorError } from '@/lib/runner/errors';
import {
  beginDispatchPreparation,
  endDispatchPreparation,
  isHarnessSessionAlive,
  persistStreamEvent as runnerPersistStreamEvent,
  recycleHarnessSessions as runnerRecycleHarnessSessions,
  recycleWhenIdle,
} from '@/lib/runner/local-runner';
import type { EventWriter, SendRequest } from '@/lib/runner/types';
import type { PendingInput } from '@/lib/runner/pending';
import { localEventWriter } from './event-writer';
import { installHomeSink } from './home-sink';
import { activeSendCount } from './live-state';
import { runnerFor } from './placement';
import { buildSessionSpec } from './session-spec';
import { harnessCapabilitiesOn, workingFolderOn } from './computers';
import { describeInputFiles, placeFilesAtHome } from './input-files';
import { awaitTurn, forgetTurn } from './turns';

installHomeSink();

/**
 * Sends past the concurrency gate that haven't reached the runner yet, per
 * chat. Building a spec takes a moment, and a harness without concurrent send
 * must refuse a second message during it, before a run is created, as it did
 * when the gate and the send were one step. On globalThis so every route
 * bundle sees the same counts.
 */
const STARTING_KEY = Symbol.for('@ri/executor-starting-sends');
const startingRef = globalThis as unknown as { [STARTING_KEY]?: Map<string, number> };
if (!startingRef[STARTING_KEY]) startingRef[STARTING_KEY] = new Map();
const startingSends = startingRef[STARTING_KEY]!;

function releaseStartingSend(chatSessionId: string): void {
  const next = (startingSends.get(chatSessionId) ?? 1) - 1;
  if (next <= 0) startingSends.delete(chatSessionId);
  else startingSends.set(chatSessionId, next);
}

export { ExecutorError } from '@/lib/runner/errors';
export { parseStreamEvent } from '@/lib/runner/parse';
export {
  isRunning,
  listRunningSessions,
  listBackgroundTaskSessions,
  hasBackgroundTasks,
  listBackgroundTaskIds,
  getSessionInventory,
  hasHarnessSession,
} from './live-state';
export {
  isHarnessSessionAlive,
  invalidateHarnessSession,
  forceClearInflight,
  beginDispatchPreparation,
  endDispatchPreparation,
  recycleWhenIdle,
  recycleForModeChange,
  closeIdleSessions,
  _beginActiveDispatch,
  _endActiveDispatch,
  _recordBackgroundTaskEvent,
  _recordSessionInventory,
  _cacheHarnessSession,
  _resetExecutorState,
  type DispatchLifecycleRef,
} from '@/lib/runner/local-runner';

/**
 * Optional opt-in flags for dispatch.
 *
 * `overBudget` — the caller has explicitly acknowledged the budget
 * overage in the UI; we proceed past the block. Otherwise we reject
 * with `budget_exceeded` and the chat surface renders a confirm prompt.
 *
 * `internalCall` — the caller is the scheduled-run wrapper in
 * `src/lib/runs/dispatch.ts` and has already evaluated the budget +
 * execution-mutex gates. Skips both checks; the scheduler is the
 * source of truth for them in this code path. Untrusted callers
 * (chat composer, route handlers) must NOT set this.
 *
 * `runId` — the scheduled run this turn belongs to, so the turn's result
 * finishes it. Manual sends create their own run.
 */
export interface DispatchOptions {
  overBudget?: boolean;
  internalCall?: boolean;
  runId?: string;
  /** The user's chat event this sends, so a message reaches its harness once however many paths try. */
  sourceEventId?: string | null;
  /** Who is sending, from the caller's credentials. */
  actor?: WorkerCommandActor;
  /**
   * The message's files. Their `[[file:]]` markers become paths on the
   * computer the chat runs on, which is known only here (P2.5).
   */
  attachments?: Attachment[];
}

/**
 * Dispatch a user message into the agent. Fire-and-forget from the
 * route handler — the returned promise resolves when the agent's turn
 * completes, but the caller doesn't have to await it.
 *
 * Concurrent send (Claude + Codex): callable mid-turn. The CLI's own
 * queue handles ordering — Claude drains queued messages into the
 * active turn as `<system-reminder>` attachments on the next tool
 * result; Codex merges them as additional userMessage items in the
 * same turn. Either way the agent's response addresses the new
 * messages without us having to do anything special.
 *
 * Non-concurrent providers such as Cursor and OpenCode reject a second
 * overlapping provider send with `already_running`, before a run exists.
 *
 * The run finishes from the turn's result (`finishRun`, through the home
 * sink), whether or not anyone is still waiting here.
 */
export async function dispatch(
  chatSessionId: string,
  userMessage: string,
  options: DispatchOptions = {},
): Promise<void> {
  const session = getChatSessionWithExecution(chatSessionId);
  if (!session) throw new ExecutorError('not_found', `Session not found: ${chatSessionId}`);
  // Someone took this over to work on it locally. Nothing sends into it
  // until they hand it back, whichever path is sending: the composer, a
  // commit or PR helper, the scheduler, a coalesced trigger, or a health
  // re-fire (docs/homes-build.md, P0.4 gap 3).
  if (session.takeoverStartedAt) {
    throw new ExecutorError(
      'invalid_state',
      'Session is being worked on locally. Run `ri resume` or click Done in the takeover banner before sending more messages.',
    );
  }

  // Where the chat runs. A chat on a connected computer runs in its folder
  // there, which the home never looks for on its own disk (P2.4).
  const placement = chatPlacement(chatSessionId);
  const remote = placement && !placement.isHome ? placement : null;
  // This message already went to its computer's queue, by another path (the
  // original send, or an earlier retry): its run and its turn are that
  // send's. A second one would only wait on a turn that never comes.
  if (remote && options.sourceEventId && getSendForEvent(options.sourceEventId)) return;
  let cwd: string | null;
  let preparing: string | null = null;
  if (remote) {
    const folder = workingFolderOn(remote, session);
    if ('problem' in folder) throw new ExecutorError('invalid_state', folder.problem);
    if ('preparing' in folder) preparing = folder.preparing;
    cwd = 'cwd' in folder ? folder.cwd : '';
  } else {
    cwd = resolveCwd(session);
  }
  if (cwd === null || (!cwd && !preparing)) throw new ExecutorError('invalid_state', 'Session has no resolvable cwd');

  // Final provider-boundary guard. Live discovery is authoritative for new
  // sends. Historical unavailable selections remain readable, but a missing
  // or disconnected model cannot silently fall through to another model.
  const providerId = session.harness;
  if (!isHarnessEnabled(providerId)) {
    throw new ExecutorError('unsupported', `${providerId} is disabled by the rollout configuration`);
  }
  // The home's own catalog stands in for a connected computer's: same
  // accounts, and the harness there refuses a model it doesn't have.
  const catalog = await getHarnessModelCatalog(providerId, { cwd: remote ? undefined : cwd });
  if (session.model && !catalog.some((model) => model.id === session.model)) {
    throw new ExecutorError(
      'invalid_state',
      `Model ${session.model} is unavailable. Reconnect the provider or choose another enabled model.`,
    );
  }
  const selection = explicitHarnessSelection(
    providerId,
    { model: session.model, variant: session.modelVariant, effort: session.effort },
    catalog,
  );
  if (session.modelVariant && selection.variant !== session.modelVariant) {
    throw new ExecutorError(
      'invalid_state',
      `Variant ${session.modelVariant} is unavailable for model ${selection.model}.`,
    );
  }
  if (
    selection.model !== session.model
    || selection.variant !== session.modelVariant
    || selection.effort !== session.effort
  ) {
    updateChatSession(session.id, {
      model: selection.model,
      modelVariant: selection.variant,
      effort: selection.effort,
    });
  }
  if (!options.internalCall) {
    const savedSelection = getUserState();
    if (
      savedSelection?.defaultHarness !== selection.providerId
      || savedSelection?.defaultModel !== selection.model
      || savedSelection?.defaultEffort !== selection.effort
    ) {
      updateUserState({
        defaultHarness: selection.providerId,
        defaultModel: selection.model,
        defaultEffort: selection.effort,
      });
    }
  }

  // Budget guard. Manual sends past the monthly ceiling require an
  // explicit `overBudget: true` from the UI's confirmation prompt.
  // Skipped for the scheduled wrapper, which evaluated the gate in
  // `dispatchRun` before getting here.
  if (!options.internalCall && !options.overBudget) {
    if (budgetGate() === 'block') {
      throw new ExecutorError(
        'budget_exceeded',
        'Monthly budget exceeded. Send again with "over budget" confirmation to proceed.',
      );
    }
  }

  // No execution-level run mutex here. Concurrent sends are a
  // first-class feature: a user's follow-up reuses this chat's live
  // session (same subprocess) and the provider's native queue absorbs it.
  // Genuine trigger-vs-trigger worktree contention is governed separately
  // by each trigger's `concurrencyPolicy` in `runs/dispatch.ts`.

  // Provider capability gate, before a run exists, so a refused send leaves
  // none behind. The runner checks the same things again. On a connected
  // computer the capabilities are what its worker reported, and its runner
  // holds the one-at-a-time gate.
  const caps = await harnessCapabilitiesOn(remote ?? { computerId: '', isHome: true }, selection.providerId, remote ? undefined : cwd);
  if (!caps.sessions) {
    throw new ExecutorError('unsupported', caps.sessionsReason ?? `${selection.providerId} sessions are unavailable`);
  }
  const starting = startingSends.get(chatSessionId) ?? 0;
  if (!remote && !caps.concurrentSend && activeSendCount(chatSessionId) + starting > 0) {
    throw new ExecutorError('already_running', 'This provider does not support concurrent send.');
  }
  // Same tick as the check: the next send sees this one. The preparation
  // reference keeps the chat marked running while its session starts.
  startingSends.set(chatSessionId, starting + 1);
  const preparation = beginDispatchPreparation(chatSessionId);
  let delivered: { turn: Promise<void> };
  try {
    delivered = await deliver(chatSessionId, userMessage, options, session, selection, cwd, remote, preparing);
  } finally {
    // Delivered or refused, the send is no longer starting. Once delivered,
    // the runner's own count holds the gate and the running flag.
    releaseStartingSend(chatSessionId);
    endDispatchPreparation(chatSessionId, preparation);
  }
  await delivered.turn;
}

/**
 * Create the run and send through the chat's runner. Resolves once the
 * harness accepted the message, with the turn to wait on.
 */
async function deliver(
  chatSessionId: string,
  userMessage: string,
  options: DispatchOptions,
  session: NonNullable<ReturnType<typeof getChatSessionWithExecution>>,
  selection: ReturnType<typeof explicitHarnessSelection>,
  cwd: string,
  remote: ChatPlacement | null,
  preparing: string | null,
): Promise<{ turn: Promise<void> }> {
  // Run-row instrumentation (task #12). Every dispatch creates a run row
  // — manual, scheduled, or webhook — so cost tracking and budget
  // guards are honest. The scheduled wrapper sets `internalCall: true`
  // because it has already created the row + registered the run; we
  // only spawn a `triggerKind='manual'` row for top-level callers.
  let runId = options.runId ?? null;
  if (!options.internalCall) {
    const created = createRunRow({
      triggerId: null,
      workspaceId: session.workspaceId ?? null,
      executionId: session.executionId ?? null,
      chatSessionId,
      harness: session.harness,
      triggerKind: 'manual',
      triggerPayload: null,
      scheduledFor: null,
      status: 'queued',
    });
    markRunStartedRow(created.id);
    beginRun(created.id, chatSessionId);
    runId = created.id;
  }

  const turnId = uuidv7();
  const turn = awaitTurn(turnId);
  const buildSpec = async () => ({
    ...(await buildSessionSpec(
      {
      chatSessionId,
      harness: session.harness,
      cwd,
      sessionType: session.type,
      workspaceId: session.workspaceId ?? null,
      surfaceKind: session.surfaceKind,
      surfaceRef: session.surfaceRef,
      existingExternalSessionId: session.externalSessionId,
      permissionMode: session.permissionMode,
      prePlanMode: (session.prePlanMode as PermissionMode | null) ?? null,
      model: selection.model,
      modelVariant: selection.variant,
      effort: selection.effort,
      },
      remote ?? undefined,
    )),
    preparedWorktreeOf: preparing,
  });
  try {
    const runner = runnerFor(chatSessionId);
    // A live session here needs no spec, so a follow-up does no spec work. A
    // connected computer always gets one.
    // Attached files: paths here for a chat at home. A connected computer
    // gets the markers as they are and the files beside them, and places
    // its own copies.
    const attachments = options.attachments ?? [];
    const request: SendRequest = {
      chatSessionId,
      message: remote ? userMessage : placeFilesAtHome(userMessage, attachments),
      turnId,
      runId,
      spec: !remote && isHarnessSessionAlive(chatSessionId) ? null : await buildSpec(),
      sourceEventId: options.sourceEventId ?? null,
      actor: options.actor,
      files: remote ? await describeInputFiles(userMessage, attachments) : undefined,
    };
    let sent = await runner.send(request);
    if (sent.status === 'needs_spec') {
      // The session ended between the check and the send.
      sent = await runner.send({ ...request, spec: await buildSpec() });
      if (sent.status === 'needs_spec') {
        throw new ExecutorError('invalid_state', 'The session could not be started.');
      }
    }
  } catch (err) {
    forgetTurn(turnId);
    // A manual send that never reached the harness fails its run here. A
    // scheduled run is failed by its wrapper, which sees this throw.
    if (!options.internalCall && runId) {
      finishRun(runId, {
        ok: false,
        errorCode: 'agent_error',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  }
  return { turn };
}

/**
 * Interrupt the current turn for a chat, if any. `actor` is who asked, from
 * their credentials, and absent for the system itself. The same goes for the
 * stops below.
 */
export async function abort(chatSessionId: string, actor?: WorkerCommandActor): Promise<void> {
  await runnerFor(chatSessionId).interrupt(chatSessionId, actor);
}

/** Stop one background task without disturbing the session or its other tasks. */
export async function stopTask(
  chatSessionId: string,
  taskId: string,
  actor?: WorkerCommandActor,
): Promise<{ stopped: boolean; queued?: boolean }> {
  return runnerFor(chatSessionId).stopTask(chatSessionId, taskId, actor);
}

/**
 * Answer a pending prompt through the chat's runner. Only a prompt this chat
 * raised can be answered, so an answer can't reach another chat's harness,
 * and only a person can approve a permission (`answerRefusal`), which
 * `refused` explains.
 */
export function answerPendingInput(
  chatSessionId: string,
  requestId: string,
  response: UserInputResponse,
  actor: WorkerCommandActor,
): { ok: true; pending: PendingInput } | { ok: false; refused?: string } {
  return runnerFor(chatSessionId).answerPendingInput(chatSessionId, requestId, response, actor);
}

/**
 * Close a chat's harness and clear its live state: when the chat is
 * archived, or to force a resume on the next send. Says honestly whether the
 * process closed.
 */
export async function close(
  chatSessionId: string,
  actor?: WorkerCommandActor,
): Promise<{ closed: boolean; error?: string; queued?: boolean }> {
  return runnerFor(chatSessionId).stop(chatSessionId, actor);
}

/**
 * Recycle every live session that carries a workspace's scope (spec §6f). Called after its connector
 * scopes, browser switch, instructions or reference folders change, so the change takes effect now
 * rather than next session (the harness caches its tool list and instructions otherwise). A session
 * mid-turn is recycled when the turn ends. A no-op for sessions that aren't currently live.
 */
export async function recycleWorkspaceSessions(workspaceId: string): Promise<void> {
  // The sessions that consume the workspace's scope: its executions and the agent's main chat
  // (docs/agents-view-spec.md Phase 6). The app's main chat and content sessions stay broad, so
  // they are left alone.
  const sessions = [
    ...listChatSessions({ workspaceId, status: 'active', type: 'execution' }),
    ...listMainChats(workspaceId, { status: 'active' }),
  ];
  await Promise.all(sessions.map((s) => recycleWhenIdle(s.id)));
}

/**
 * Recycle only the agent's main chat, for settings nothing else receives:
 * its name and purpose live in the main chat's brief, not in executions.
 */
export async function recycleAgentMainChats(workspaceId: string): Promise<void> {
  await Promise.all(listMainChats(workspaceId, { status: 'active' }).map((s) => recycleWhenIdle(s.id)));
}

/**
 * Recycle live sessions after a reference folder changes, so an added or
 * removed folder takes effect now rather than whenever the session happens to
 * restart. Session config (`instructionsFile`, `--add-dir`, the deny rules) is
 * fixed at spawn, so without this the running agent keeps the old list
 * indefinitely — the same problem connector scopes solve via
 * `recycleWorkspaceSessions`.
 *
 * A global reference (`workspaceId === null`) is visible everywhere, so it has
 * to recycle every workspace's executions and agent main chats, not just one.
 */
export async function recycleForReferenceFolderChange(
  workspaceId: string | null,
): Promise<void> {
  if (workspaceId) return recycleWorkspaceSessions(workspaceId);
  const sessions = [
    ...listChatSessions({ status: 'active', type: 'execution' }),
    // Every agent's main chat, not the app's (listMainChats(null)).
    ...listChatSessions({ status: 'active', type: 'orchestration' }).filter(
      (s) => s.workspaceId && !s.executionId && !s.createdByRunId,
    ),
  ];
  await Promise.all(sessions.map((s) => recycleWhenIdle(s.id)));
}

/**
 * Close every live session for one harness after its credential store
 * changes. Agentex retires its runtime generation, while this clears handles
 * that captured the old environment or retired OpenCode server.
 */
export async function recycleHarnessSessions(harness: ProviderId): Promise<void> {
  installHomeSink();
  await runnerRecycleHarnessSessions(harness);
}

/**
 * Report one provider stream event, as the live session does. Reconcile
 * uses it to replay a native transcript, with the plain database writer by
 * default so a replay never counts run telemetry twice.
 */
export async function persistStreamEvent(
  chatSessionId: string,
  event: StreamEvent,
  writer: EventWriter = localEventWriter,
  options: { trackBackgroundTaskRuntime?: boolean } = {},
): Promise<void> {
  installHomeSink();
  await runnerPersistStreamEvent(chatSessionId, event, writer, options);
}

// ─── Helpers ──────────────────────────────────────────────────

/**
 * For git workspaces: the worktree path. For non-git: the workspace's
 * cwd directly. Returns null if the chat_session has no workspace.
 *
 * `worktreePath` lives on the execution now, so callers pass a flattened
 * `getChatSessionWithExecution` row (or anything structurally carrying the
 * two fields). Accepting it structurally keeps this compiling after the
 * legacy chat_sessions columns are dropped.
 *
 * Stale-path guard: an execution row can outlive its worktree (archive
 * teardown, manual `git worktree remove`/`prune`, dev resets, a
 * multi-device home where `.work` wasn't synced, reconciler running
 * offline). Auto-resume-on-view handles the click-archived-chat case by
 * nulling `worktreePath` before re-provision, but dispatch/reconcile can
 * still see stale paths in the other scenarios.
 *
 * Critically, for a GIT workspace we must NOT fall through to the
 * workspace's source checkout when the worktree is missing. The worktree
 * is the unit of per-execution isolation; running the agent in `ws.cwd`
 * instead means it reads, edits, and commits in the user's main tree on
 * whatever branch happens to be checked out there. We return null so the
 * caller fails loud (`dispatch` throws `invalid_state`, `reconcile` skips
 * with `no_cwd`) or, better, reprovisions first (`ensureWorktreeReady`,
 * which the scheduled path and the message route both run before
 * dispatch). The `ws.cwd` fallback is correct only for NON-git workspaces,
 * which have no worktree concept. (Live mode keeps `worktreePath ===
 * ws.cwd`, so the existence check above already returns it.) The one
 * exception is an agent's main chat, which has no execution and runs in the
 * folder by design (docs/agents-view-spec.md §4).
 */
export function resolveCwd(session: {
  worktreePath: string | null;
  workspaceId: string | null;
  type: 'orchestration' | 'content' | 'execution';
  executionId: string | null;
}): string | null {
  if (session.worktreePath && existsSync(session.worktreePath)) return session.worktreePath;
  if (!session.workspaceId) {
    // No workspace → the session runs in the app data root. This is the
    // orchestrator/content path: interactive orchestrator chats and
    // scheduled `targetKind='orchestrator'` fires both land here (the
    // latter previously dead-ended with "no resolvable cwd"). The
    // orchestrator branch in `ensureHarnessSession` runs `ensureAppRoot()`
    // via the surface installer before the process spawns.
    return getAppRoot();
  }
  const workspace = getWorkspace(session.workspaceId);
  if (!workspace) return null;
  // An agent's main chat (orchestration with a workspace, no execution)
  // runs in the agent's own folder, git or not. It manages work there
  // rather than doing it: in a git agent its file-editing tools are denied
  // and changes go through executions (see agent-main-chat.ts). A folder
  // that has gone away is refused like a missing worktree.
  if (session.type === 'orchestration' && !session.executionId) {
    return existsSync(workspace.cwd) ? workspace.cwd : null;
  }
  // Git workspace with no usable worktree → refuse rather than silently
  // running the agent in the shared source checkout.
  if (workspace.isGit) return null;
  return workspace.cwd ?? null;
}
