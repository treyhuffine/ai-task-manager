/**
 * Canonical task lifecycle.
 *
 * One source of truth for the stored status vocabulary, the human-facing
 * labels, the transition matrix, and the derived predicates every surface
 * (query layer, REST, CLI, MCP, UI, Deck, Stream, calendar) reasons about.
 *
 * The five stored states each name a distinct truth (see docs/prd.md and the
 * Ri lifecycle spec):
 *   - consider     — a human-owned possibility (idea, decision, maybe-task,
 *                    verification, experiment). Not a commitment.
 *   - todo         — accepted into the committed queue, not currently WIP.
 *   - in_progress  — the outcome is deliberately underway; occupies one WIP
 *                    slot. Persists through pauses, crashes, handoffs, review.
 *   - done         — the outcome happened and was accepted.
 *   - archived     — no longer pursued, without claiming completion.
 *
 * `active` is no longer canonical. "Current"/"active" work is the derived
 * union `todo | in_progress`. `ready`, `working`, `blocked`, `review`,
 * `stalled`, `needs input` are DERIVED signals, never stored states.
 *
 * This module has no imports from the schema or the DB so it stays a pure,
 * cheaply-testable leaf that both the schema (for its column enum) and the
 * query layer can depend on without a cycle.
 */

export const TASK_STATUSES = ['consider', 'todo', 'in_progress', 'done', 'archived'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  consider: 'Consider',
  todo: 'Todo',
  in_progress: 'In progress',
  done: 'Done',
  archived: 'Archived',
};

/**
 * The pre-lifecycle model stored `active`. It is intentionally NOT a canonical
 * value. It survives only so that reads of a not-yet-backfilled row, and a
 * write from an in-flight agent that still speaks the old vocabulary, do not
 * hard-error. Everything normalizes it to `todo`. Removed once the backfill
 * receipt is clean (see scripts/backfill-task-lifecycle.ts).
 */
export const LEGACY_ACTIVE = 'active';

export function isTaskStatus(raw: unknown): raw is TaskStatus {
  return typeof raw === 'string' && (TASK_STATUSES as readonly string[]).includes(raw);
}

/**
 * Coerce any stored/incoming status token to a canonical value. Legacy
 * `active` and any unknown/absent value map to `todo` — the committed queue —
 * because that is the only safe default that never fabricates a terminal
 * state or invents WIP/Consider intent the row never had.
 */
export function normalizeTaskStatus(raw: string | null | undefined): TaskStatus {
  if (isTaskStatus(raw)) return raw;
  return 'todo';
}

// ─── Commands & transition matrix ─────────────────────────────

/**
 * Semantic lifecycle commands. Names are the public contract (CLI, MCP, REST,
 * UI all speak them) so renaming breaks every learned agent. `complete` is
 * carried here for the matrix but is dispatched through the dedicated
 * `complete_task` path (it records a completion and rolls recurrence).
 * `start_with_agent` / `continue_with_agent` are execution operations layered
 * on `start` (→ in_progress) and on staying in_progress; their lifecycle
 * destination is captured by `start` and by the WIP-preserving no-op here.
 */
export const LIFECYCLE_COMMANDS = [
  'move_to_todo',
  'move_to_consider',
  'start',
  'return_to_todo',
  'complete',
  'reopen',
  'archive',
  'restore',
] as const;

export type LifecycleCommand = (typeof LIFECYCLE_COMMANDS)[number];

/** Semantic commands exposed as a single generic transition action. `complete`
 * (recurrence-aware) and the agent-start variants have their own entrypoints. */
export const TRANSITION_COMMANDS = [
  'move_to_todo',
  'move_to_consider',
  'start',
  'return_to_todo',
  'reopen',
  'archive',
  'restore',
] as const;

export type TransitionCommand = (typeof TRANSITION_COMMANDS)[number];

export function isTransitionCommand(raw: unknown): raw is TransitionCommand {
  return typeof raw === 'string' && (TRANSITION_COMMANDS as readonly string[]).includes(raw);
}

interface TransitionDef {
  /** States from which the command is legal. */
  from: readonly TaskStatus[];
  /** Resulting state (recurrence overrides `complete` to `todo` at runtime). */
  to: TaskStatus;
  /** Human label for buttons, menus, and confirmations. */
  label: string;
}

export const TRANSITIONS: Record<LifecycleCommand, TransitionDef> = {
  move_to_todo: { from: ['consider'], to: 'todo', label: 'Move to Todo' },
  move_to_consider: { from: ['todo'], to: 'consider', label: 'Move to Consider' },
  start: { from: ['consider', 'todo'], to: 'in_progress', label: 'Start' },
  return_to_todo: { from: ['in_progress'], to: 'todo', label: 'Return to Todo' },
  complete: { from: ['todo', 'in_progress'], to: 'done', label: 'Complete' },
  reopen: { from: ['done'], to: 'todo', label: 'Reopen' },
  archive: { from: ['consider', 'todo', 'in_progress'], to: 'archived', label: 'Archive' },
  restore: { from: ['archived'], to: 'todo', label: 'Restore' },
};

export function transitionLabel(command: LifecycleCommand): string {
  return TRANSITIONS[command].label;
}

export function canApply(command: LifecycleCommand, from: TaskStatus): boolean {
  return TRANSITIONS[command].from.includes(from);
}

export function targetState(command: LifecycleCommand): TaskStatus {
  return TRANSITIONS[command].to;
}

/** Semantic commands legal from `from`, for building menus and drag guards. */
export function availableCommands(from: TaskStatus): LifecycleCommand[] {
  return LIFECYCLE_COMMANDS.filter((c) => canApply(c, from));
}

// ─── Derived predicates ───────────────────────────────────────

/** Not terminal: still a live possibility, commitment, or WIP. */
export function isOpen(s: TaskStatus): boolean {
  return s === 'consider' || s === 'todo' || s === 'in_progress';
}

/** The derived "current"/"active" union that replaces the old `active`. */
export function isCommitted(s: TaskStatus): boolean {
  return s === 'todo' || s === 'in_progress';
}

/** Occupies a WIP slot and belongs in Current Work. */
export function isWip(s: TaskStatus): boolean {
  return s === 'in_progress';
}

export function isTerminal(s: TaskStatus): boolean {
  return s === 'done' || s === 'archived';
}

/** Legal target of a Stream merge (Consider/Todo/In progress, never terminal). */
export function isMergeable(s: TaskStatus): boolean {
  return isOpen(s);
}

/** Shown on the commitment calendar. Consider stays off it (uses resurface). */
export function isCalendarVisible(s: TaskStatus): boolean {
  return isCommitted(s);
}

/**
 * Everything is searchable, but Consider must be visibly labeled and is
 * excluded from ambient pickers/suggestions unless explicitly searched — that
 * exclusion is expressed by `isAmbientSuggestable`, not by hiding it here.
 */
export function isSearchable(_s: TaskStatus): boolean {
  return true;
}

/** Ambient pickers & launch suggestions surface In progress then Todo, never
 * Consider (unless the caller explicitly opts Consider in). */
export function isAmbientSuggestable(s: TaskStatus): boolean {
  return s === 'in_progress' || s === 'todo';
}

// ─── Ready / Deck eligibility (need runtime inputs) ───────────

export interface ReadyInputs {
  status: TaskStatus;
  /** An unresolved blocker relationship exists (blocker not Done/resolved). */
  hasUnresolvedBlocker: boolean;
  /** ISO timestamp; Consider→Todo preserves this so a committed item can still
   * be temporally ineligible until due. */
  resurfaceAfter: string | null;
  /** Recurrence cadence string, when the task is recurring. */
  recurrence: string | null;
  /** ISO timestamp of the next scheduled occurrence, when recurring. */
  nextRecurrenceAt: string | null;
  /** ISO "now" for temporal comparisons. */
  now: string;
}

/**
 * Ready = committed and eligible to be picked up right now:
 * status is `todo`, no unresolved blocker, resurfaceAfter absent or due, and
 * recurrence absent or its next occurrence due. In progress is deliberately
 * NOT Ready — it is already underway and lives in Current Work, not the
 * generated daily stack.
 */
export function isReady(i: ReadyInputs): boolean {
  if (i.status !== 'todo') return false;
  if (i.hasUnresolvedBlocker) return false;
  if (i.resurfaceAfter && i.resurfaceAfter > i.now) return false;
  if (i.recurrence && i.nextRecurrenceAt && i.nextRecurrenceAt > i.now) return false;
  return true;
}

/** Ready Todo feeds the generated daily stack. In progress never does. */
export function isDeckEligible(i: ReadyInputs): boolean {
  return isReady(i);
}

// ─── Consider preconditions ───────────────────────────────────

export interface ConsiderPreconditionInputs {
  hardDeadline: string | null;
  recurrence: string | null;
  hasUnresolvedBlocker: boolean;
  hasLiveOwningExecution: boolean;
}

/**
 * Moving Todo → Consider removes a commitment without discarding the idea, so
 * it is rejected while the row still carries commitment-bearing facts. Returns
 * the human-readable reasons it is blocked (empty = allowed). The command never
 * silently clears these facts; the caller surfaces them.
 */
export function considerBlockers(i: ConsiderPreconditionInputs): string[] {
  const reasons: string[] = [];
  if (i.hardDeadline) reasons.push('a hard deadline');
  if (i.recurrence) reasons.push('a recurrence');
  if (i.hasUnresolvedBlocker) reasons.push('an unresolved blocker');
  if (i.hasLiveOwningExecution) reasons.push('a live owning execution');
  return reasons;
}

// ─── Commitment-bearing fields disallowed on Consider ─────────

/**
 * Fields that assert a commitment and therefore cannot be set while a task is
 * (or is becoming) Consider. Used by the query chokepoint to reject invalid
 * generic updates with an actionable error.
 */
export const CONSIDER_FORBIDDEN_FIELDS = ['hardDeadline', 'recurrence', 'reminderAt'] as const;

// ─── Errors ───────────────────────────────────────────────────

export type LifecycleErrorCode =
  | 'not_found'
  | 'invalid_transition'
  | 'conflict'
  | 'consider_precondition'
  | 'active_execution';

/**
 * A lifecycle command that could not be applied. Carries a stable `code` so the
 * REST, CLI, and MCP boundaries can map it to the right envelope (a conflict is
 * a retryable optimistic-concurrency failure, not a bug) without string
 * matching. Never thrown for a successful idempotent replay.
 */
export class TaskLifecycleError extends Error {
  code: LifecycleErrorCode;
  details?: unknown;
  constructor(code: LifecycleErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'TaskLifecycleError';
    this.code = code;
    this.details = details;
  }
}

export function isTaskLifecycleError(err: unknown): err is TaskLifecycleError {
  return err instanceof TaskLifecycleError;
}

/** HTTP status for each lifecycle error code, for the REST boundary. */
export const LIFECYCLE_ERROR_HTTP_STATUS: Record<LifecycleErrorCode, number> = {
  not_found: 404,
  invalid_transition: 422,
  conflict: 409,
  consider_precondition: 422,
  active_execution: 409,
};

/** Orchestrator ActionError code for each lifecycle error code, for CLI/MCP. */
export const LIFECYCLE_ERROR_ACTION_CODE: Record<LifecycleErrorCode, 'not_found' | 'invalid_params' | 'conflict' | 'unsupported'> = {
  not_found: 'not_found',
  invalid_transition: 'invalid_params',
  conflict: 'conflict',
  consider_precondition: 'invalid_params',
  active_execution: 'conflict',
};
