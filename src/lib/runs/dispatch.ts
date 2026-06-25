/**
 * Unified runs dispatcher — the single chokepoint that creates a `runs`
 * row, resolves the right `executions`/`chat_sessions` pair, runs the
 * execution-level mutex check, and hands off to the executor.
 *
 * Three callers reach this file:
 *   - Scheduler tick (`@/lib/scheduler/runner`) for scheduled fires
 *   - Webhook intake (`/api/triggers/[public_id]`) for HMAC-verified
 *     external triggers
 *   - The existing executor adapter (manual chat sends) — added in
 *     task #12, so manual chat shows up in the same run history
 *
 * Behavior derives from `schedule.kind` + `schedule.targetKind` per
 * docs/executions-spec.md §6. No `session_strategy` enum.
 */

import { existsSync as fsExistsSync } from 'node:fs';
import { uuidv7 } from 'uuidv7';
import { getDb } from '@/lib/db';
import { chatSessions as chatSessionsTable } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type {
  ScheduleRecord,
  RunRecord,
  RunTrigger,
  ChatSessionRecord,
  ExecutionRecord,
} from '@/db/types';
import {
  createExecutionWithChat,
  getExecution,
  updateSchedule,
  createRun,
  markRunStarted,
  markRunCompleted,
  markRunFailed,
  setScheduleLastRun,
  findActiveRunForExecution,
  findActiveRunForSchedule,
  bumpSessionOutcome,
  getWorkspace,
  insertChatEvent,
  resetExecutionForReprovision,
} from '@/lib/db/queries';
import { notifyRunTerminal } from '@/lib/notifications/emit';
import { withApiLease } from '@/lib/scheduler/rate-lease';
import { dispatch as executorDispatch, abort as executorAbort } from '@/lib/executor/adapter';
import { provisionWorktreeForSession } from '@/lib/sessions/dispatch';
import { runArtifactBucket } from './artifact-bucket';
import { budgetGate, BUDGET_DISABLED_REASON } from './budget';

export interface DispatchRunArgs {
  schedule: ScheduleRecord;
  trigger: RunTrigger;
  /** Raw webhook payload (kind='webhook' only). */
  triggerPayload?: Record<string, unknown> | string | null;
  /** When the scheduler tick decided this slot should fire. */
  scheduledFor?: string | null;
}

export interface DispatchedRunResult {
  run: RunRecord;
  /** Null for `skipped` outcomes (no chat created). */
  chatSession: ChatSessionRecord | null;
}

/**
 * The full dispatch lifecycle for a scheduled (or webhook-triggered)
 * fire. Returns the created run row whatever the outcome (skipped /
 * queued / running). Caller doesn't await the underlying executor —
 * this function returns once the run row is durable + the executor
 * subprocess has been spawned.
 */
export async function dispatchRun(args: DispatchRunArgs): Promise<DispatchedRunResult> {
  const { schedule, trigger, triggerPayload = null, scheduledFor = null } = args;

  // 0. Budget guard. Block + auto-pause scheduled fires at 100%. The
  //    user_state.monthly_budget_usd is the single ceiling; in-flight
  //    runs are allowed to complete. See docs/async-agents-v1.md §4.7.
  if (budgetGate() === 'block') {
    updateSchedule(schedule.id, {
      enabled: false,
      disabledReason: BUDGET_DISABLED_REASON,
    });
    const skipped = recordSkipped({
      schedule,
      executionId: null,
      workspaceId: schedule.workspaceId ?? null,
      chatSessionId: null,
      trigger,
      triggerPayload,
      scheduledFor,
      reason: BUDGET_DISABLED_REASON,
    });
    setScheduleLastRun(schedule.id, skipped.id, 'skipped');
    return { run: skipped, chatSession: null };
  }

  // 1. Resolve the target execution (or null for orchestrator schedules)
  //    + the chat session this run will speak through.
  const resolved = resolveTarget(schedule);

  // 2. Concurrency gate per docs/executions-spec.md §5. Defer the new
  //    fire per the *firing* schedule's `concurrencyPolicy`, regardless
  //    of whether the blocker is the same or a different schedule
  //    sharing the execution.
  //
  //    Workspace-target override: `allow_concurrent` degrades to
  //    `skip_if_running` (with a one-line warn) because V1 doesn't
  //    support true parallel worktree mutation — two runs writing to
  //    the same .git directory race. True parallel is a V2 feature.
  //    Orchestrator targets have no shared worktree, so
  //    `allow_concurrent` falls through naturally and a second run
  //    spawns.
  const blocker = resolved.execution
    ? findActiveRunForExecution(resolved.execution.id)
    : findActiveRunForSchedule(schedule.id);
  if (blocker) {
    let policy = schedule.concurrencyPolicy;
    if (policy === 'allow_concurrent' && resolved.execution) {
      console.warn(
        `[dispatch] schedule "${schedule.name}": allow_concurrent treated as ` +
          `skip_if_running for workspace target (executions-spec §5). True ` +
          `parallel execution mutation is a V2 feature.`,
      );
      policy = 'skip_if_running';
    }
    const desiredReason = scheduleConcurrencyReason(policy);
    if (desiredReason !== null) {
      const wantsCoalesce = policy === 'coalesce_if_active';
      const canCoalesce = wantsCoalesce && !!blocker.chatSessionId;
      // For coalesce paths, append the new prompt + source marker into
      // the blocker's chat. The agent's running session picks it up on
      // the next turn (Claude/Codex both queue concurrent sends). When
      // the blocker has no chat to land in (rare — manual fire-paths
      // can spawn that), we degrade to a plain skip so the recorded
      // `statusReason` doesn't claim a delivery that never happened.
      if (canCoalesce) {
        appendCoalescedMessage({
          blockerChatSessionId: blocker.chatSessionId!,
          schedule,
          triggerPayload,
        });
      }
      // For workspace targets that have a blocker from a different
      // schedule, the appropriate reason code is `execution_busy`
      // (not `schedule_busy`) so the run row tells the truth about
      // why it deferred.
      let reason: string;
      if (canCoalesce) {
        reason = desiredReason;
      } else if (resolved.execution && blocker.scheduleId !== schedule.id) {
        reason = 'execution_busy';
      } else {
        reason = 'schedule_busy';
      }
      const skipped = recordSkipped({
        schedule,
        executionId: resolved.execution?.id ?? null,
        workspaceId: resolved.execution?.workspaceId ?? schedule.workspaceId ?? null,
        // Link the skipped row back to the chat that absorbed the
        // prompt so it isn't orphaned in the inbox; null when we
        // degraded to plain skip.
        chatSessionId: canCoalesce ? blocker.chatSessionId : null,
        trigger,
        triggerPayload,
        scheduledFor,
        reason,
      });
      setScheduleLastRun(schedule.id, skipped.id, 'skipped');
      return { run: skipped, chatSession: null };
    }
  }

  // 3. Materialize the chat session for this fire. Recurring workspace
  //    schedules accumulate chats inside the owned execution; one-offs
  //    and orchestrator schedules get a fresh chat each fire. If
  //    resolveTarget already created one (eager-creation path), reuse it.
  const chat = resolved.chat ?? createChatForFire(schedule, resolved.execution);

  // 4. Insert the run row in `queued`. Trigger payload is JSON.stringified
  //    by the column's json mode automatically.
  const run = createRun({
    scheduleId: schedule.id,
    workspaceId: resolved.execution?.workspaceId ?? schedule.workspaceId ?? null,
    executionId: resolved.execution?.id ?? null,
    chatSessionId: chat.id,
    agentId: schedule.agentId,
    trigger,
    triggerPayload,
    scheduledFor,
    status: 'queued',
  });

  // First fire against this chat → record the creator. Subsequent runs
  // through the same chat don't mutate this — they're tracked via
  // `runs.chatSessionId` instead. See docs/async-agents-v1.md §4.3.
  if (!chat.createdByRunId) {
    const db = getDb();
    db.update(chatSessionsTable)
      .set({ createdByRunId: run.id })
      .where(eq(chatSessionsTable.id, chat.id))
      .run();
  }

  // 5. Move to running + spawn the executor. Errors during run-time
  //    land on the run row via the result-event handler (cost +
  //    summary + artifact capture) wired in src/lib/executor/adapter.ts.
  markRunStarted(run.id);
  void runUnderLease(run.id, chat.id, schedule, resolved.execution, triggerPayload);

  return { run, chatSession: chat };
}

/**
 * Resolve the (executionId, chatSession) target for this fire per the
 * derived dispatch rules. Side-effects: may insert a new execution row
 * and/or update `schedules.owning_execution_id`. Synchronous because
 * everything in the queries layer is synchronous.
 *
 * For fresh git-workspace executions we set `setupStartedAt` so the UI
 * lights up the "setting up" state immediately; the actual worktree
 * provisioning happens inside `runUnderLease` (awaited so the agent
 * lands in the correct cwd, not the bare workspace).
 */
function resolveTarget(schedule: ScheduleRecord): {
  execution: ExecutionRecord | null;
  /** Pre-existing reusable chat — set only when we explicitly want to
   *  coalesce into a known target. Otherwise null = create a fresh chat. */
  chat: ChatSessionRecord | null;
} {
  // Orchestrator targets: no execution, always fresh chat.
  if (schedule.targetKind === 'orchestrator') {
    return { execution: null, chat: null };
  }

  // One-off semantics: `at` (a scheduled single fire) and `manual`
  // (no cadence, only fires via Run now) both create a fresh
  // execution + fresh chat per dispatch. Recurring kinds reuse the
  // owning execution below.
  if (schedule.kind === 'at' || schedule.kind === 'manual') {
    if (!schedule.workspaceId) {
      throw new Error(`Schedule ${schedule.id} targets workspace but has no workspace_id`);
    }
    const ws = getWorkspace(schedule.workspaceId);
    const { execution, session } = createExecutionWithChat({
      workspaceId: schedule.workspaceId,
      agentId: schedule.agentId,
      label: schedule.name,
      setupStartedAt: ws?.isGit ? new Date().toISOString() : null,
      model: schedule.model,
      effort: schedule.effort,
    });
    return { execution, chat: session };
  }

  // Workspace recurring (cron / every): reuse the schedule's owning
  // execution if active, else create one and persist the FK.
  if (!schedule.workspaceId) {
    throw new Error(`Schedule ${schedule.id} targets workspace but has no workspace_id`);
  }
  let execution: ExecutionRecord | null = null;
  if (schedule.owningExecutionId) {
    const existing = getExecution(schedule.owningExecutionId);
    if (existing && existing.status === 'active') execution = existing;
  }
  if (!execution) {
    const ws = getWorkspace(schedule.workspaceId);
    const created = createExecutionWithChat({
      workspaceId: schedule.workspaceId,
      agentId: schedule.agentId,
      label: schedule.name,
      setupStartedAt: ws?.isGit ? new Date().toISOString() : null,
      model: schedule.model,
      effort: schedule.effort,
    });
    execution = created.execution;
    updateSchedule(schedule.id, { owningExecutionId: execution.id });
    // Reuse the eagerly-created chat for the *first* fire so we don't
    // spawn an empty sibling.
    return { execution, chat: created.session };
  }
  // Existing execution → always fresh chat (the speed payoff of the lift).
  return { execution, chat: null };
}

/**
 * Materialize a brand-new chat against an execution (or no execution,
 * for orchestrator fires). Always creates a `type='execution'` chat
 * when there's a workspace, `type='orchestration'` otherwise.
 */
function createChatForFire(
  schedule: ScheduleRecord,
  execution: ExecutionRecord | null,
): ChatSessionRecord {
  const db = getDb();
  const id = uuidv7();
  return db
    .insert(chatSessionsTable)
    .values({
      id,
      agentId: schedule.agentId,
      type: execution ? 'execution' : 'orchestration',
      workspaceId: execution?.workspaceId ?? schedule.workspaceId ?? null,
      executionId: execution?.id ?? null,
      label: schedule.name,
      status: 'active',
      // Propagate the schedule's per-run overrides onto the chat so the
      // executor adapter's `ensureAgentSession` picks them up via the
      // session row (it reads model/effort/permissionMode/etc. fresh
      // each turn). Schedule edits to model/effort take effect on the
      // next fire's chat — existing chats keep their snapshot.
      ...(schedule.model !== null ? { model: schedule.model } : {}),
      ...(schedule.effort !== null ? { effort: schedule.effort } : {}),
    })
    .returning()
    .get();
}

/**
 * Map a schedule's concurrency policy to the skip reason recorded on a
 * blocked run. Returns null when the policy says "spawn anyway" — the
 * caller proceeds normally.
 */
function scheduleConcurrencyReason(
  policy: ScheduleRecord['concurrencyPolicy'],
): string | null {
  switch (policy) {
    case 'skip_if_running':
      return 'schedule_busy';
    case 'coalesce_if_active':
      return 'coalesced_into_active';
    case 'allow_concurrent':
      return null;
  }
}

interface RecordSkippedArgs {
  schedule: ScheduleRecord;
  executionId: string | null;
  workspaceId: string | null;
  chatSessionId: string | null;
  trigger: RunTrigger;
  triggerPayload: Record<string, unknown> | string | null;
  scheduledFor: string | null;
  reason: string;
}

/**
 * Coalesce path: deliver the new fire's prompt into the blocker's
 * active chat as a follow-up user message. Both Claude and Codex
 * support concurrent send — the message lands as a `<system-reminder>`
 * attachment on the next tool result (Claude) or as an extra
 * userMessage in the same turn (Codex). The blocker's run row owns the
 * cost + summary; we record a `skipped` row separately so the schedule
 * history shows the fire happened and where it went.
 *
 * The `[from schedule <name>]` source marker keeps the transcript
 * legible when the blocker chat is owned by a different schedule.
 */
function appendCoalescedMessage(args: {
  blockerChatSessionId: string;
  schedule: ScheduleRecord;
  triggerPayload: Record<string, unknown> | string | null;
}): void {
  const content = composeCoalescedContent(args.schedule, args.triggerPayload);
  try {
    insertChatEvent({
      sessionId: args.blockerChatSessionId,
      role: 'user',
      source: 'user',
      content,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn(`[dispatch] coalesce: failed to persist user event for ${args.blockerChatSessionId}:`, err);
    return;
  }
  // Fire-and-forget — the blocker's run will surface the result when
  // its current turn completes. We catch the rejection ourselves so an
  // unhandled rejection doesn't trip the Node process.
  void executorDispatch(args.blockerChatSessionId, content, undefined, { internalCall: true })
    .catch((err) => {
      console.warn(`[dispatch] coalesce: executor send failed for ${args.blockerChatSessionId}:`, err);
    });
}

function composeCoalescedContent(
  schedule: ScheduleRecord,
  triggerPayload: Record<string, unknown> | string | null,
): string {
  const header = `[from schedule ${schedule.name}]`;
  return `${header}\n\n${composePromptWithPayload(schedule.prompt, triggerPayload)}`;
}

function recordSkipped(args: RecordSkippedArgs): RunRecord {
  const now = new Date().toISOString();
  return createRun({
    scheduleId: args.schedule.id,
    executionId: args.executionId,
    workspaceId: args.workspaceId,
    chatSessionId: args.chatSessionId,
    agentId: args.schedule.agentId,
    trigger: args.trigger,
    triggerPayload: args.triggerPayload,
    scheduledFor: args.scheduledFor,
    status: 'skipped',
    statusReason: args.reason,
    queuedAt: now,
    completedAt: now,
  });
}

/**
 * Run the executor under the global API lease, then mark the run
 * terminal. Two awaited phases:
 *
 *   1. Worktree provisioning (git workspaces only) — awaited so the
 *      agent's cwd resolves to the worktree, not the source checkout.
 *      Failed provisioning marks the run failed without invoking the
 *      executor and surfaces `setupError` on the execution for the UI.
 *   2. Executor dispatch — the detailed cost/summary/artifact capture
 *      lands via the result-event handler wired in
 *      `src/lib/executor/adapter.ts`; here we bracket success vs
 *      failure and stamp the timing rows the handler doesn't own.
 */
async function runUnderLease(
  runId: string,
  chatSessionId: string,
  schedule: ScheduleRecord,
  execution: ExecutionRecord | null,
  triggerPayload: Record<string, unknown> | string | null,
): Promise<void> {
  try {
    const ready = await ensureWorktreeReady(chatSessionId, execution);
    if (!ready.ok) {
      finalizeRunFailure(runId, schedule.id, new ProvisioningError(ready.error));
      // Auto-pause the schedule. Without this the tick re-fires every
      // minute, each fire failing the same way — the user's inbox fills
      // with identical failure rows until `consecutiveFailures >= 3`
      // lights the banner. The disabledReason lets the schedule detail
      // surface explain why we paused (and the user can resume after
      // fixing the underlying repo state).
      updateSchedule(schedule.id, {
        enabled: false,
        disabledReason: 'worktree_setup_failed',
      });
      bumpSessionOutcome(chatSessionId);
      return;
    }
    await withApiLease(async () => {
      const prompt = composePromptWithPayload(schedule.prompt, triggerPayload);
      // Persist a user chat_event mirroring the route layer's pattern
      // for normal sends. Without this, scheduled chats show only the
      // agent's responses with no record of what triggered them — and
      // run history becomes ambiguous if the schedule's prompt later
      // changes. The agent's stream output still arrives via the
      // adapter's onEvent callback unchanged.
      try {
        insertChatEvent({
          sessionId: chatSessionId,
          role: 'user',
          source: 'user',
          content: prompt,
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        console.warn(`[dispatch] failed to persist scheduled prompt event for ${chatSessionId}:`, err);
      }
      await runArtifactBucket.runWith(runId, chatSessionId, () =>
        runWithTimeout(chatSessionId, schedule, () =>
          executorDispatch(chatSessionId, prompt, undefined, { internalCall: true }),
        ),
      );
    });
    finalizeRunSuccessIfPending(runId, schedule.id);
  } catch (err) {
    finalizeRunFailure(runId, schedule.id, err);
  }
  // The chat's lastOutcomeEventAt is bumped by the event-writer on
  // every assistant message — but a failure before any assistant turn
  // would leave the inbox quiet. Touch it so failed runs surface.
  bumpSessionOutcome(chatSessionId);
}

/**
 * For git workspaces, ensure the execution's worktree is provisioned
 * before we hand off to the executor. Skips when there's no execution
 * (orchestrator targets), the workspace isn't git, or the worktree is
 * already there (subsequent fires reuse the artifact — the V1 speed
 * payoff). Returns `{ ok: false }` with a human-readable error when
 * provisioning has failed in a way the run row should reflect.
 */
async function ensureWorktreeReady(
  chatSessionId: string,
  execution: ExecutionRecord | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!execution) return { ok: true };
  const ws = getWorkspace(execution.workspaceId);
  if (!ws) return { ok: false, error: `Workspace ${execution.workspaceId} not found` };
  if (!ws.isGit) return { ok: true };

  // Trust the recorded path only if the directory still exists on
  // disk. A worktree can be torn down out-of-band (archive sweep,
  // manual `git worktree remove`, dev resets) — without this check we
  // silently fall through `resolveCwd`'s graceful fallback and run the
  // agent against the source checkout, breaking the per-execution
  // isolation invariant.
  if (execution.worktreePath && fsExistsSync(execution.worktreePath)) {
    return { ok: true };
  }

  // The path is null OR points at a dir that no longer exists. Reset
  // the worktree-identity fields so the provisioner produces a fresh
  // clone instead of trying to attach to the stale path, then
  // (re)provision. `resetExecutionForReprovision` also clears
  // setupError so we don't get caught by the auto-pause guard below
  // when the previous failure was the missing dir.
  if (execution.worktreePath && !fsExistsSync(execution.worktreePath)) {
    console.warn(
      `[dispatch] execution ${execution.id} worktreePath ${execution.worktreePath} is missing, reprovisioning`,
    );
    resetExecutionForReprovision(execution.id);
  } else if (execution.setupError) {
    // First-time setup that previously failed — don't silently
    // hammer the broken clone every minute. User-driven retry is the
    // recovery path; the schedule has been auto-paused upstream.
    return { ok: false, error: `Worktree setup previously failed: ${execution.setupError}` };
  }

  await provisionWorktreeForSession({
    ws,
    executionId: execution.id,
    sessionId: chatSessionId,
    label: execution.label,
    baseBranchOverride: null,
    prNumber: execution.prNumber ?? null,
  });

  const refreshed = getExecution(execution.id);
  if (!refreshed) return { ok: false, error: `Execution ${execution.id} vanished mid-provision` };
  if (refreshed.setupError) {
    return { ok: false, error: refreshed.setupError };
  }
  if (!refreshed.worktreePath || !fsExistsSync(refreshed.worktreePath)) {
    return { ok: false, error: 'Worktree provisioning produced no usable path' };
  }
  return { ok: true };
}

class ProvisioningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProvisioningError';
  }
}

/**
 * Sentinel for a scheduled run that exceeded its `timeoutSeconds`. We
 * own the timeout at this layer because `@agentex/agent` only honors
 * `ProviderConfig.timeoutSec` for single-shot `exec()` calls — its
 * `AgentSession.send()` lifecycle has no per-turn timeout (the only
 * `setTimeout` in the claude session module is the 5s SIGTERM→SIGKILL
 * grace in `close()`). Long-term fix lives upstream; this is the V1
 * workaround.
 */
class RunTimeoutError extends Error {
  constructor(public timeoutSeconds: number) {
    super(`Run exceeded ${timeoutSeconds}s timeout`);
    this.name = 'RunTimeoutError';
  }
}

/**
 * Race the executor body against the schedule's `timeoutSeconds`. On
 * timeout we interrupt the agent (best-effort — `interrupt()` sends a
 * graceful control request) and reject so the run row lands as failed
 * with `errorCode: 'timeout'`. Treat `timeoutSeconds <= 0` as "no
 * timeout" so users who don't care can opt out by setting 0; the
 * schedule default (900s / 15min) ships in the create_schedule
 * action.
 */
async function runWithTimeout<T>(
  chatSessionId: string,
  schedule: ScheduleRecord,
  body: () => Promise<T>,
): Promise<T> {
  const seconds = schedule.timeoutSeconds;
  if (!seconds || seconds <= 0) return body();
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Interrupt is fire-and-forget — the agent's pending `send()`
      // will resolve with an aborted result, but we've already
      // rejected the race. Catch defensively so an unhandled
      // rejection here doesn't trip the process.
      executorAbort(chatSessionId).catch(() => { /* best-effort */ });
      reject(new RunTimeoutError(seconds));
    }, seconds * 1000);
  });
  try {
    return await Promise.race([body(), timeout]);
  } finally {
    // Always clear the timer so a fast finish doesn't leak a pending
    // `setTimeout`. Without this, the reject above eventually still
    // fires on a closed chat — harmless but noisy in logs.
    if (timer) clearTimeout(timer);
  }
}

/**
 * Render the schedule's prompt with the trigger payload appended when
 * present. For webhook intake, the payload is the entire body the
 * external system sent — wrap as fenced JSON so the agent sees it
 * cleanly without us forcing a JSON-only assumption.
 */
function composePromptWithPayload(
  prompt: string,
  payload: Record<string, unknown> | string | null,
): string {
  if (payload == null) return prompt;
  if (typeof payload === 'string') {
    return `${prompt}\n\n--- trigger payload ---\n${payload}`;
  }
  return `${prompt}\n\n--- trigger payload (JSON) ---\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
}

function finalizeRunSuccessIfPending(runId: string, scheduleId: string | null): void {
  const completed = markRunCompleted(runId);
  if (completed && completed.status === 'completed' && scheduleId) {
    setScheduleLastRun(scheduleId, runId, 'completed');
  }
  // Notifier (best-effort): execution.finished / schedule.run_completed (§2.4).
  void notifyRunTerminal(runId).catch(() => {});
}

function finalizeRunFailure(runId: string, scheduleId: string | null, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const errorCode =
    err instanceof ProvisioningError ? 'worktree_setup_failed' :
    err instanceof RunTimeoutError ? 'timeout' :
    'agent_error';
  markRunFailed(runId, { errorCode, errorMessage: message });
  if (scheduleId) setScheduleLastRun(scheduleId, runId, 'failed');
  void notifyRunTerminal(runId).catch(() => {});
}
