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

import { withActivity, readMaintenance } from '@/lib/service/maintenance';
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
  heldMessages,
  holdForTransfer,
  holdingTransfer,
} from '@/lib/db/queries';
import { admitSend } from '@/lib/transfer/moving';
import { getAppRoot } from '@/lib/config/paths';
import type { Attachment, PermissionMode, WorkerCommandActor } from '@/db/types';
import { budgetGate } from '@/lib/runs/budget';
import { beginRun } from '@/lib/runs/artifact-bucket';
import { finishRun } from '@/lib/runs/finish';
import { explicitHarnessSelection, type ProviderId } from '@/lib/harness/options';
import { getHarnessModelCatalog } from '@/lib/harness/model-discovery';
import { isHarnessEnabled } from '@/lib/harness/registry';
import { ExecutorError } from '@/lib/runner/errors';
import { IMPORT_MIRROR_REFUSAL, isImportMirror } from '@/lib/import/mirror';
import { announceDelivery, announceHeld } from '@/lib/workers/delivery';
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
import { harnessCapabilitiesOn, workingFolderOn } from './devices';
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

/**
 * What became of an attempt to send a message: its harness or its
 * device's queue has it; it was held, or the work changed hands, so it
 * starts over; or it failed before anything took it.
 */
type SendAttempt = { kind: 'accepted' } | { kind: 'again' } | { kind: 'failed'; error: unknown };

interface Sending {
  settled: Promise<SendAttempt>;
  settle(attempt: SendAttempt): void;
}

/**
 * Messages being sent right now, here or to a connected device, by their
 * chat event, with what became of the attempt once it's known. A second
 * dispatch of one waits for that rather than making a run of its own:
 * being prepared isn't being accepted (P4 final re-check). On globalThis
 * for the same reason.
 */
const SENDING_KEY = Symbol.for('@ri/executor-sending-events');
const sendingRef = globalThis as unknown as { [SENDING_KEY]?: Map<string, Sending> };
if (!(sendingRef[SENDING_KEY] instanceof Map)) sendingRef[SENDING_KEY] = new Map();
const sendingEvents = sendingRef[SENDING_KEY]!;

function reserveSending(eventId: string): Sending {
  let resolve!: (attempt: SendAttempt) => void;
  let done = false;
  const sending: Sending = {
    settled: new Promise<SendAttempt>((r) => (resolve = r)),
    settle(attempt) {
      if (done) return;
      done = true;
      // Only an accepted one keeps its place (a later dispatch of it returns
      // at once). One that wasn't lets the next attempt take over.
      if (attempt.kind !== 'accepted' && sendingEvents.get(eventId) === sending) sendingEvents.delete(eventId);
      resolve(attempt);
    },
  };
  sendingEvents.set(eventId, sending);
  return sending;
}

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
   * device the chat runs on, which is known only here (P2.5).
   */
  attachments?: Attachment[];
  /**
   * Called once the message is saved in its device's queue, for a chat
   * elsewhere (P3.2). From then on what the chat is doing is its device's
   * to say: running when the worker reports its turn, and the message's
   * delivery state until then. A caller holding the chat busy for the
   * dispatch lets go here, so a message waiting for a device that's away
   * doesn't read as working.
   */
  onQueued?: () => void;
  /**
   * The command a message to a device elsewhere waits in, once it's
   * queued: a scheduled run starts its clock only when that device takes
   * it (P3 review).
   */
  onQueuedCommand?: (commandId: string) => void;
  /**
   * A move holds this message instead: it goes out once the move settles
   * (`deliverHeld`). The dispatch resolves then too, with nothing sent. A
   * scheduled fire waits as its run rather than finishing (P3 re-check).
   */
  onHeld?: () => void;
  /**
   * The caller gave up on this send: a scheduled run whose time ran out
   * while it was being prepared (P3 re-check). Once aborted, the send
   * boundary refuses it rather than send, queue or hold it, so a run that
   * failed leaves nothing behind to run later.
   */
  signal?: AbortSignal;
  /**
   * Called once the next message can follow this one: when the chat's
   * harness has it and takes messages mid-turn, or its device's queue has
   * it (a worker takes them in turn), or a move holds it. For a harness here
   * that takes one message at a time, when its turn is over. What a delivery
   * of several messages in order waits for, rather than every whole turn.
   */
  onAccepted?: () => void;
  /**
   * The transfer delivering this held message (`deliverHeld`): the one send
   * its hold lets through. Everything else waits in line behind it.
   */
  heldFor?: string;
}

/**
 * The send starts over: the work changed hands while it was being prepared
 * (it goes to the new owner), or another attempt at the same message was
 * held (it's held again, or its delivery sends it).
 */
class StartOver extends Error {}

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
  // Admitted only while the service isn't preparing an update (desktop
  // maintenance): an update waits for the sends already in, and refuses new ones.
  return withActivity(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await dispatchOnce(chatSessionId, userMessage, options);
      } catch (err) {
        if (err instanceof StartOver && attempt < 2) continue;
        throw err;
      }
    }
  });
}

async function dispatchOnce(
  chatSessionId: string,
  userMessage: string,
  options: DispatchOptions,
): Promise<void> {
  const session = getChatSessionWithExecution(chatSessionId);
  if (!session) throw new ExecutorError('not_found', `Session not found: ${chatSessionId}`);
  // An import nobody has taken over has no session to resume. A send would
  // start a blank one under a transcript it never saw, on whichever device
  // the import came from, whoever is sending.
  if (isImportMirror(session)) throw new ExecutorError('invalid_state', IMPORT_MIRROR_REFUSAL);

  // Moving to another device (P4.2): the message is saved and held, and
  // goes once to wherever the work ends up. Nothing reaches the source while
  // it's being stopped and saved, nor either side while a move that stopped
  // waits for Try again, Resume or Finish (P4 review).
  if (session.executionId) {
    if (holdingTransfer(session.executionId) && holdHere(chatSessionId, session.executionId, options)) {
      options.onQueued?.();
      options.onHeld?.();
      return;
    }
    // Held by a move, one that stopped or one delivering where it arrived
    // (P4.4): it goes with Resume, Try again or that delivery, never on its
    // own. A health re-fire on opening the chat, or a retry, finds it here.
    const heldBy = options.sourceEventId ? heldMessages(session.executionId).get(options.sourceEventId) : undefined;
    if (heldBy && options.sourceEventId && heldBy.transfer.id !== options.heldFor) {
      options.onQueued?.();
      options.onHeld?.();
      announceHeld(chatSessionId, options.sourceEventId);
      return;
    }
  }

  // Where the chat runs. A chat on a connected device runs in its folder
  // there, which the home never looks for on its own disk (P2.4). An agent's
  // main chat that hasn't run yet goes where its agent lives now (P3.4).
  if (!session.executionId) {
    const { followAgentUntilRun } = await import('@/lib/sessions/main-chat-device');
    followAgentUntilRun(chatSessionId);
  }
  const placement = chatPlacement(chatSessionId);
  const remote = placement && !placement.isHome ? placement : null;
  // This message already went to its device's queue, or is on its way
  // there or to the harness here, by another path (the original send, an
  // earlier retry, a second Resume, or one overlapping this): its run and
  // its turn are that send's. A second one would only make a run and wait on
  // a turn that never come, or send it twice. The check and the reservation
  // are in the same tick, so overlapping dispatches can't both pass (P2 and
  // P4 review fixes).
  const sourceEventId = options.sourceEventId ?? null;
  if (sourceEventId) {
    const other = sendingEvents.get(sourceEventId);
    if (other) {
      // That attempt's reservation isn't acceptance: wait for what became of it.
      const attempt = await other.settled;
      if (attempt.kind === 'accepted') {
        options.onAccepted?.();
        return;
      }
      if (attempt.kind === 'failed') throw attempt.error;
      throw new StartOver();
    }
    if (remote && getSendForEvent(sourceEventId)) {
      options.onAccepted?.();
      return;
    }
  }
  const sending = sourceEventId ? reserveSending(sourceEventId) : null;
  try {
    await dispatchTo(chatSessionId, userMessage, options, session, remote, placement, (attempt) => sending?.settle(attempt));
  } catch (err) {
    sending?.settle(err instanceof StartOver ? { kind: 'again' } : { kind: 'failed', error: err });
    throw err;
  } finally {
    // Once this dispatch ends, the queue itself answers for the message.
    sending?.settle({ kind: 'again' });
    if (sourceEventId && sendingEvents.get(sourceEventId) === sending) sendingEvents.delete(sourceEventId);
  }
}

/**
 * Hold a message for the move that holds the execution's messages: true when
 * it's held. A send with no saved message to hold is refused instead.
 */
function holdHere(chatSessionId: string, executionId: string, options: DispatchOptions): boolean {
  const holding = holdingTransfer(executionId);
  // The delivery of what a move held sends its own messages through.
  if (!holding || holding.id === options.heldFor) return false;
  if (!options.sourceEventId) {
    throw new ExecutorError(
      'invalid_state',
      holding.state === 'active'
        ? 'This execution is moving to another device. Send again once it has arrived.'
        : 'Its move to another device stopped. Try again, resume it or finish it, then send again.',
    );
  }
  const held = holdForTransfer(executionId, options.sourceEventId);
  if (!held) return false;
  announceHeld(chatSessionId, options.sourceEventId);
  // In line behind messages a settled move is delivering: that delivery takes it too.
  if (held.state === 'cancelled' || held.state === 'succeeded') {
    void import('@/lib/transfer/continue').then((m) => m.continueHeldDelivery(held.id)).catch(() => {});
  }
  return true;
}

/** How a send ended up: with the harness here, in its device's queue, or held by a move. */
interface Delivered {
  turn: Promise<void>;
  outcome: 'sent' | 'queued' | 'held';
  /** The command it waits in, when queued for a device elsewhere. */
  commandId?: string;
  /** Another message can follow it now, rather than when its turn is over. */
  acceptsMore: boolean;
}

async function dispatchTo(
  chatSessionId: string,
  userMessage: string,
  options: DispatchOptions,
  session: NonNullable<ReturnType<typeof getChatSessionWithExecution>>,
  remote: ChatPlacement | null,
  placement: ChatPlacement | null,
  settle: (attempt: SendAttempt) => void,
): Promise<void> {
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
  // The home's own catalog stands in for a connected device's: same
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
  // device the capabilities are what its worker reported, and its runner
  // holds the one-at-a-time gate.
  const caps = await harnessCapabilitiesOn(remote ?? { deviceId: '', isHome: true }, selection.providerId, remote ? undefined : cwd);
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
  let delivered: Delivered;
  try {
    delivered = await deliver(chatSessionId, userMessage, options, session, selection, cwd, remote, preparing, placement, caps.concurrentSend);
  } finally {
    // Delivered or refused, the send is no longer starting. Once delivered,
    // the runner's own count holds the gate and the running flag.
    releaseStartingSend(chatSessionId);
    endDispatchPreparation(chatSessionId, preparation);
  }
  // Another dispatch of this message waiting on this one learns what became of it.
  settle(delivered.outcome === 'held' ? { kind: 'again' } : { kind: 'accepted' });
  // Said once the chat no longer reads as busy with this dispatch: a message
  // waiting in a queue, or held by a move, isn't the chat working. Accepted
  // only when something took it, never when it was held.
  if (delivered.outcome !== 'sent') options.onQueued?.();
  if (delivered.outcome === 'held') options.onHeld?.();
  if (delivered.commandId) options.onQueuedCommand?.(delivered.commandId);
  if (delivered.outcome === 'queued' || (delivered.outcome === 'sent' && delivered.acceptsMore)) options.onAccepted?.();
  try {
    await delivered.turn;
  } finally {
    // A harness that takes one message at a time: the next can follow once this turn is over.
    if (delivered.outcome === 'sent' && !delivered.acceptsMore) options.onAccepted?.();
  }
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
  placement: ChatPlacement | null,
  concurrentSend: boolean,
): Promise<Delivered> {
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
      executionId: session.executionId ?? null,
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
  // A live session here needs no spec, so a follow-up does no spec work. A
  // connected device always gets one. Attached files: paths here for a chat
  // at home. A connected device gets the markers as they are and the files
  // beside them, and places its own copies.
  const spec = !remote && isHarnessSessionAlive(chatSessionId) ? null : await buildSpec();
  const attachments = options.attachments ?? [];
  const files = remote ? await describeInputFiles(userMessage, attachments) : undefined;

  // The send boundary (P4 review). Everything above can take a while, and a
  // move can start or stop meanwhile, or finish and hand the work to another
  // device. So here, in the same tick as the send is counted: a move under
  // way, or one that stopped, holds the message; work that changed hands
  // starts the send over for its new owner; otherwise the send is counted
  // until its harness has it, and a move stops the source only after that.
  const held: Delivered = { turn: Promise.resolve(), outcome: 'held', acceptsMore: true };
  if (options.signal?.aborted) throw new ExecutorError('invalid_state', 'It was given up before it was sent.');
  if (session.executionId && holdingTransfer(session.executionId)) {
    if (holdHere(chatSessionId, session.executionId, options)) return held;
  }
  const now = chatPlacement(chatSessionId);
  if (now?.deviceId !== placement?.deviceId || now?.generation !== placement?.generation) throw new StartOver();
  const admitted = admitSend(session.executionId);
  if (!admitted) {
    if (session.executionId && holdHere(chatSessionId, session.executionId, options)) return held;
    throw new StartOver();
  }
  try {
    const sent = await sendAdmitted(chatSessionId, userMessage, options, session, remote, spec, files, attachments, buildSpec);
    return { ...sent, acceptsMore: !!remote || concurrentSend };
  } finally {
    admitted();
  }
}

async function sendAdmitted(
  chatSessionId: string,
  userMessage: string,
  options: DispatchOptions,
  session: NonNullable<ReturnType<typeof getChatSessionWithExecution>>,
  remote: ChatPlacement | null,
  spec: SendRequest['spec'],
  files: SendRequest['files'],
  attachments: Attachment[],
  buildSpec: () => Promise<NonNullable<SendRequest['spec']>>,
): Promise<Omit<Delivered, 'acceptsMore'>> {
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
  let queued: string | null = null;
  try {
    const runner = runnerFor(chatSessionId);
    const request: SendRequest = {
      chatSessionId,
      message: remote ? userMessage : placeFilesAtHome(userMessage, attachments),
      turnId,
      runId,
      spec,
      sourceEventId: options.sourceEventId ?? null,
      actor: options.actor,
      files,
      signal: options.signal,
    };
    let sent = await runner.send(request);
    if (sent.status === 'needs_spec') {
      // The session ended between the check and the send.
      sent = await runner.send({ ...request, spec: await buildSpec() });
      if (sent.status === 'needs_spec') {
        throw new ExecutorError('invalid_state', 'The session could not be started.');
      }
    }
    if (sent.status === 'queued') {
      announceDelivery(sent.commandId);
      queued = sent.commandId;
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
  return queued ? { turn, outcome: 'queued', commandId: queued } : { turn, outcome: 'sent' };
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

/** Called only after the service closes admission. Cached idle harnesses can
 * resume from their native histories after an update. Busy turns, tasks and
 * permission waits are never interrupted by maintenance. Only this device's
 * own sessions: a connected device's worker keeps its own. */
export async function closeIdleHarnessesForMaintenance(): Promise<void> {
  if (readMaintenance()?.phase !== 'draining') throw new Error('Maintenance admission must be closed first');
  const { closeIdleForMaintenance } = await import('@/lib/runner/local-runner');
  await closeIdleForMaintenance();
}
