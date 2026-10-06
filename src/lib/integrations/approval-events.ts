/**
 * Where integration approvals meet the rest of the app: the chat transcript, notifications, the
 * Integrations settings, and the waiting agent.
 *
 *   - A new pending approval becomes an `approval_request` row in the chat that asked. The
 *     transcript renders consecutive rows of one kind as a single approval card, and the row keeps
 *     a plain-language view (account, action, what the call touches) so the card still reads after
 *     the in-memory pending is gone.
 *   - The human's decision becomes an `approval_response` row (durable, so the card shows
 *     approved / always allowed / denied after a reload or restart), and a short note is dispatched
 *     into the session so the agent's waiting turn moves again: retry on approval, stand down on
 *     denial. Approving is what the user asked for, so continuing automatically saves them a second
 *     message, and the note names the exact calls so a partial decision is unambiguous.
 *   - "Always allow" flips the action through the same stores the Integrations settings screen
 *     writes (write-policy overrides, or an MCP server's per-tool "Ask first"), so it shows there
 *     and can be turned back.
 *
 * Only the approve route (human, from the UI) reaches `recordApprovalDecision` and
 * `allowWithoutAsking`. No orchestrator action or integration tool resolves an approval.
 */
import type { IntegrationRuntime } from '@integrations/engine';
import type { ChatEventSource } from '@/db/types';
import { getChatSessionWithExecution, insertChatEvent } from '@/lib/db/queries';
import { isImportMirror } from '@/lib/import/mirror';
import { notify } from '@/lib/notifications';
import { healthCheckSession } from '@/lib/executor/health';
import { dispatchSessionTurn } from '@/lib/sessions/deliver';
import { getIntegrationRuntime, getMcpServerStore, invalidateIntegrationRuntime } from './runtime';
import { defaultApprovalMode, isOutwardAction, setActionOverride } from './write-policy';
import { GRANT_TTL_MS, type ApprovalDecision, type PendingApproval, type ResolvedApproval } from './approval';
import {
  actionLabel,
  approvalNote,
  subjectFromRecord,
  subjectLookupActionId,
  summarizeCall,
  toolNameFor,
  type ApprovalOutcome,
  type ApprovalRequestView,
  type ApprovalResponseView,
} from './approval-describe';

const LOOKUP_TIMEOUT_MS = 4_000;
const NOTIFY_BATCH_MS = 1_500;
/** Identifies the subject lookups in the integration run log; they are reads, so never gated. */
const PREVIEW_CALLER = { type: 'app', id: 'approval-preview' } as const;

interface ActionMeta {
  toolkitName: string;
  providerId: string;
  /** The toolkit's non-mutating action ids, for the subject lookup. */
  readActionIds: Set<string>;
}

const MCP_ACTION = /^mcp\.([A-Za-z0-9_]+)\.(.+)$/;

/** The name the user gave an MCP server ("Team Calendar"), rather than its `MCP: <slug>` toolkit. */
function mcpServerName(actionId: string): string | null {
  const slug = MCP_ACTION.exec(actionId)?.[1];
  if (!slug) return null;
  try {
    return getMcpServerStore().list().find((s) => s.slug === slug)?.displayName ?? null;
  } catch {
    return null;
  }
}

function actionMeta(runtime: IntegrationRuntime | null, p: PendingApproval): ActionMeta {
  const toolkit = runtime?.getToolkits().find((t) => t.actions.some((a) => a.id === p.actionId));
  return {
    toolkitName: mcpServerName(p.actionId) ?? toolkit?.displayName ?? p.providerId,
    providerId: toolkit?.providerId ?? p.providerId,
    readActionIds: new Set(toolkit?.actions.filter((a) => !a.mutating).map((a) => a.id) ?? []),
  };
}

async function runtimeOrNull(): Promise<IntegrationRuntime | null> {
  try {
    return await getIntegrationRuntime();
  } catch {
    return null;
  }
}

/**
 * Name the target of an id-only call (a calendar delete carries just the event id) by running the
 * toolkit's sibling read on the same connection. Best-effort and bounded: no subject is fine.
 */
async function lookUpSubject(runtime: IntegrationRuntime | null, meta: ActionMeta, p: PendingApproval): Promise<string | null> {
  const lookupId = runtime ? subjectLookupActionId(p.actionId, meta.readActionIds) : null;
  if (!runtime || !lookupId) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      runtime.runAction(lookupId, p.preview, {
        ownerId: p.ownerId,
        connectionId: p.connectionId,
        caller: PREVIEW_CALLER,
      }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS);
      }),
    ]);
    return outcome?.ok ? subjectFromRecord(outcome.result) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function baseView(p: PendingApproval, meta: ActionMeta) {
  return {
    actionId: p.actionId,
    toolName: toolNameFor(p.actionId),
    actionLabel: actionLabel(p.actionId),
    toolkitName: meta.toolkitName,
    // An MCP server's connection is vestigial (its label is just the server slug), not an account.
    account: MCP_ACTION.test(p.actionId) ? null : p.account,
  };
}

/** A session that exists and can take a new turn from the app. */
function deliverableSession(sessionId: string) {
  const session = getChatSessionWithExecution(sessionId);
  if (!session || session.status === 'archived' || isImportMirror(session)) return null;
  return session;
}

// ── Requests ────────────────────────────────────────────────────────────────

interface NotifyBatch {
  first: PendingApproval;
  view: ApprovalRequestView;
  count: number;
}
const notifyBatches = new Map<string, NotifyBatch>();

/**
 * One notification per burst of the same kind: an agent deleting 8 events in parallel asks 8
 * times within milliseconds, and the human needs one ping, not eight.
 */
function queueNotification(p: PendingApproval, view: ApprovalRequestView): void {
  const key = [p.sessionId ?? '', p.actionId, p.connectionId].join('|');
  const batch = notifyBatches.get(key);
  if (batch) {
    batch.count += 1;
    return;
  }
  notifyBatches.set(key, { first: p, view, count: 1 });
  setTimeout(() => {
    const done = notifyBatches.get(key);
    notifyBatches.delete(key);
    if (!done) return;
    const { first, view: v, count } = done;
    const what = count > 1 ? `${v.actionLabel} × ${count}` : `${v.actionLabel}: ${v.summary}`;
    void notify({
      type: 'integration.approval_required',
      userId: first.ownerId,
      dedupeKey: `integration.approval_required:${first.id}`,
      title: 'Approval needed',
      body: `${v.toolkitName}${v.account ? ` (${v.account})` : ''}. ${what}`,
      // Opens the chat whose card holds the buttons.
      url: first.sessionId ? `/?session=${first.sessionId}` : '/integrations-test',
    }).catch(() => {});
  }, NOTIFY_BATCH_MS);
}

/** A new pending approval: card in the asking chat's transcript, plus a (batched) notification. */
export async function recordApprovalRequested(p: PendingApproval): Promise<void> {
  const runtime = await runtimeOrNull();
  const meta = actionMeta(runtime, p);
  const subject = await lookUpSubject(runtime, meta, p);
  const { summary, details } = summarizeCall(p.preview, subject);
  const view: ApprovalRequestView = {
    approvalId: p.id,
    ...baseView(p, meta),
    providerId: meta.providerId,
    connectionId: p.connectionId,
    risk: p.risk,
    outward: isOutwardAction(p.actionId),
    summary,
    details,
  };
  if (p.sessionId && getChatSessionWithExecution(p.sessionId)) {
    insertChatEvent({
      sessionId: p.sessionId,
      role: 'system',
      source: 'approval_request' satisfies ChatEventSource,
      content: `${view.actionLabel}: ${summary}`,
      toolName: view.toolName,
      toolInput: view,
      // Idempotency key, namespaced so it can never collide with a provider event id.
      externalEventId: `integration-approval:${p.id}`,
      // Stamped at request time so the card sorts beside the call that asked, not after the lookup.
      createdAt: new Date(p.createdAt).toISOString(),
    });
  }
  queueNotification(p, view);
}

// ── Decisions ───────────────────────────────────────────────────────────────

/** Group a session's approvals by kind (action on one account), preserving order. */
function byKind<T extends PendingApproval>(items: readonly T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = `${item.actionId}|${item.connectionId}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()];
}

function bySession<T extends PendingApproval>(items: readonly T[]): Map<string, T[]> {
  const sessions = new Map<string, T[]>();
  for (const item of items) {
    if (!item.sessionId) continue;
    sessions.set(item.sessionId, [...(sessions.get(item.sessionId) ?? []), item]);
  }
  return sessions;
}

const OUTCOME_TEXT: Record<ApprovalOutcome, string> = {
  approve: 'Approved',
  always: 'Always allowed',
  deny: 'Denied',
  settled: 'Ran under your current settings',
};

function insertResponse(sessionId: string, group: PendingApproval[], outcome: ApprovalOutcome, runtime: IntegrationRuntime | null) {
  const first = group[0]!;
  const view: ApprovalResponseView = {
    outcome,
    approvalIds: group.map((p) => p.id),
    ...baseView(first, actionMeta(runtime, first)),
  };
  insertChatEvent({
    sessionId,
    role: 'system',
    source: 'approval_response' satisfies ChatEventSource,
    content: `${OUTCOME_TEXT[outcome]}: ${view.actionLabel}${group.length > 1 ? ` × ${group.length}` : ''}`,
    toolName: view.toolName,
    toolInput: view,
    toolIsError: outcome === 'deny',
    createdAt: new Date().toISOString(),
  });
}

/**
 * Record the human's decision in each asking chat and move the waiting agent along. The response
 * row lands first, so the transcript shows the decision before the agent's retry.
 */
export async function recordApprovalDecision(resolved: readonly ResolvedApproval[], decision: ApprovalDecision): Promise<void> {
  const runtime = await runtimeOrNull();
  for (const [sessionId, items] of bySession(resolved)) {
    if (!getChatSessionWithExecution(sessionId)) continue;
    for (const group of byKind(items)) insertResponse(sessionId, group, decision, runtime);

    const session = deliverableSession(sessionId);
    if (!session) continue;
    const note = approvalNote(
      decision,
      items.map((p) => ({ toolName: toolNameFor(p.actionId), account: p.account, preview: p.preview })),
      Math.round(GRANT_TTL_MS / 60_000),
    );
    // Same self-heal the messages route runs before a send: a dead cached harness handle would
    // otherwise swallow the note. Never redispatch orphans here, the note is its own turn.
    try {
      await healthCheckSession(sessionId, { redispatchOrphans: false });
    } catch (err) {
      console.error(`[integrations] pre-dispatch health check failed for ${sessionId}:`, err);
    }
    dispatchSessionTurn(sessionId, session.executionId ?? null, note);
  }
}

/** Pendings that went moot because the same chat's identical call ran anyway (policy flipped). */
export async function recordApprovalsSettled(settled: readonly PendingApproval[]): Promise<void> {
  const runtime = await runtimeOrNull();
  for (const [sessionId, items] of bySession(settled)) {
    if (!getChatSessionWithExecution(sessionId)) continue;
    for (const group of byKind(items)) insertResponse(sessionId, group, 'settled', runtime);
  }
}

// ── Always allow ────────────────────────────────────────────────────────────

/**
 * Stop asking before `actionId` runs, through the setting the Integrations screen shows for it:
 *   - an ingested MCP tool: the server's per-tool "Ask first" (`toolOverrides[tool].mutating`);
 *   - any other action: the write-policy override. Landing on the built-in default clears the
 *     override instead of pinning it, exactly like the settings switch, so "changed" keeps meaning
 *     "differs from the default".
 */
export async function allowWithoutAsking(actionId: string, risk: string): Promise<void> {
  const mcp = MCP_ACTION.exec(actionId);
  if (mcp) {
    const [, slug, tool] = mcp;
    const store = getMcpServerStore();
    const entry = store.list().find((s) => s.slug === slug);
    if (!entry) throw new Error(`MCP server "${slug}" is no longer configured`);
    const current = entry.toolOverrides ?? {};
    await store.update(entry.id, {
      toolOverrides: { ...current, [tool!]: { ...current[tool!], mutating: false } },
    });
    invalidateIntegrationRuntime();
    return;
  }
  const facts = { actionId, risk: risk as Parameters<typeof defaultApprovalMode>[0]['risk'], mutating: true };
  setActionOverride(actionId, defaultApprovalMode(facts) === 'auto' ? null : 'auto');
}
