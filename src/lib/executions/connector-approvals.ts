/**
 * Transcript model for connector approval cards (see connectors/approval-events.ts).
 *
 * Every paused connector call writes one `approval_request` row. An agent often fires a batch of
 * the same call in parallel (eight calendar deletes), so the transcript folds the rows of one kind
 * (the same action on the same account) that belong to one burst into a single card with one set
 * of buttons. A burst is a stretch of the agent's tool activity: tool calls, results and thinking
 * keep it open, anything the reader sees (a message, a decision, the user typing) closes it. So a
 * retry that asks again after a decision starts a fresh card instead of reviving an answered one.
 *
 * A card item's state comes from two places: the recorded `approval_response` rows (durable, so
 * decisions survive reloads and restarts) and the live pending ids the session stream pushes
 * (in-memory on the server). Undecided and not live means the request is gone: expired.
 *
 * Pure and client-safe, so it unit-tests without React.
 */
import type {
  ApprovalOutcome,
  ApprovalRequestView,
  ApprovalResponseView,
} from '@/lib/connectors/approval-describe';

type EventLike = { id: string; source: string; toolInput?: unknown };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The request view an `approval_request` row carries, or null for anything else. */
export function approvalRequestView(event: EventLike): ApprovalRequestView | null {
  if (event.source !== 'approval_request') return null;
  const v = asRecord(event.toolInput);
  if (!v || typeof v.approvalId !== 'string' || typeof v.actionId !== 'string') return null;
  return {
    approvalId: v.approvalId,
    actionId: v.actionId,
    toolName: typeof v.toolName === 'string' ? v.toolName : v.actionId,
    actionLabel: typeof v.actionLabel === 'string' ? v.actionLabel : v.actionId,
    toolkitName: typeof v.toolkitName === 'string' ? v.toolkitName : '',
    providerId: typeof v.providerId === 'string' ? v.providerId : '',
    connectionId: typeof v.connectionId === 'string' ? v.connectionId : '',
    account: typeof v.account === 'string' ? v.account : null,
    risk: typeof v.risk === 'string' ? v.risk : 'medium',
    outward: v.outward === true,
    summary: typeof v.summary === 'string' ? v.summary : '',
    details: Array.isArray(v.details)
      ? v.details.filter(
          (d): d is { label: string; value: string } =>
            !!d && typeof d === 'object' && typeof (d as { label?: unknown }).label === 'string'
            && typeof (d as { value?: unknown }).value === 'string',
        )
      : [],
  };
}

const OUTCOMES: ReadonlySet<string> = new Set(['approve', 'always', 'deny', 'settled']);

/** The decision an `approval_response` row records, or null for anything else. */
export function approvalResponseView(event: EventLike): ApprovalResponseView | null {
  if (event.source !== 'approval_response') return null;
  const v = asRecord(event.toolInput);
  if (!v || typeof v.outcome !== 'string' || !OUTCOMES.has(v.outcome) || !Array.isArray(v.approvalIds)) return null;
  return {
    outcome: v.outcome as ApprovalOutcome,
    approvalIds: v.approvalIds.filter((x): x is string => typeof x === 'string'),
    actionId: typeof v.actionId === 'string' ? v.actionId : '',
    toolName: typeof v.toolName === 'string' ? v.toolName : '',
    actionLabel: typeof v.actionLabel === 'string' ? v.actionLabel : '',
    toolkitName: typeof v.toolkitName === 'string' ? v.toolkitName : '',
    account: typeof v.account === 'string' ? v.account : null,
  };
}

/** Rows that keep an approval burst open: the agent's own tool activity. */
const BURST_SOURCES: ReadonlySet<string> = new Set(['thinking', 'tool_call', 'tool_result', 'approval_request']);

/**
 * Fold each burst's `approval_request` rows of one kind into the first of them. The returned
 * `events` keep only that leader row (in place), and `groups` maps each leader's id to every row
 * of its card, in order.
 */
export function coalesceApprovalRequests<T extends EventLike>(events: readonly T[]): { events: T[]; groups: Map<string, T[]> } {
  const out: T[] = [];
  const groups = new Map<string, T[]>();
  let open = new Map<string, T>(); // kind → leader, for the current burst
  for (const event of events) {
    if (!BURST_SOURCES.has(event.source)) open = new Map();
    const view = approvalRequestView(event);
    if (!view) {
      out.push(event);
      continue;
    }
    const kind = `${view.actionId}|${view.connectionId}`;
    const leader = open.get(kind);
    if (leader) {
      groups.get(leader.id)!.push(event);
      continue;
    }
    open.set(kind, event);
    groups.set(event.id, [event]);
    out.push(event);
  }
  return { events: out, groups };
}

/** approvalId → recorded outcome, from every `approval_response` row. */
export function approvalDecisions(events: readonly EventLike[]): Map<string, ApprovalOutcome> {
  const decisions = new Map<string, ApprovalOutcome>();
  for (const event of events) {
    const view = approvalResponseView(event);
    if (!view) continue;
    for (const id of view.approvalIds) decisions.set(id, view.outcome);
  }
  return decisions;
}

export type ApprovalItemState = ApprovalOutcome | 'pending' | 'expired' | 'loading';

/**
 * One request's state. A recorded decision wins. Otherwise it's pending while the server still
 * holds it, `loading` until the live set is known, and expired once it's known to be gone.
 */
export function approvalItemState(
  approvalId: string,
  decisions: ReadonlyMap<string, ApprovalOutcome>,
  live: ReadonlySet<string> | undefined,
): ApprovalItemState {
  const decided = decisions.get(approvalId);
  if (decided) return decided;
  if (!live) return 'loading';
  return live.has(approvalId) ? 'pending' : 'expired';
}

/** Per-state counts for a card, for its status line. */
export function countStates(states: readonly ApprovalItemState[]): Partial<Record<ApprovalItemState, number>> {
  const counts: Partial<Record<ApprovalItemState, number>> = {};
  for (const s of states) counts[s] = (counts[s] ?? 0) + 1;
  return counts;
}
