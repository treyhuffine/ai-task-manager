/**
 * Host ApprovalPolicy for the connector engine — the real, grant-remembering gate that replaces
 * the dev auto-allow. The engine calls `check()` inside `runAction` (the single chokepoint);
 * this owns the policy:
 *
 *   - non-mutating actions run freely;
 *   - mutating actions the user's write-policy marks 'auto' (reversible, internal writes on an
 *     account they connected) also run freely — see write-policy.ts;
 *   - the rest (outward sends, irreversible high-risk) need a grant keyed on (ownerId, actionId,
 *     connectionId, inputDigest, actionVersion) — the exact key the spec mandates, so the retry
 *     after a human approves
 *     matches (and a grant auto-invalidates when the input/schema/risk changes, because
 *     inputDigest/actionVersion change);
 *   - with no grant, a pending approval is registered (deduped by key + asking chat) and `'ask'`
 *     is returned, which the runtime turns into an `approval_required` outcome.
 *
 * The human approves out-of-band, from the approval card in the chat that asked
 * (`resolvePendingApprovals`, exposed only via /api/connectors/approve — never as an agent tool);
 * the agent re-invokes the tool and the grant now matches → `'allow'`. A grant is scoped to the
 * chat whose request was approved, so another session making the identical call can't spend it.
 * In dev, `autoApprove` bypasses the gate so the chat demos end-to-end; production runs the real
 * gate.
 *
 * Which chat asked comes from the caller: the connectors MCP route stamps
 * `{ type: 'mcp', id: 'session:<chatSessionId>' }` from the session's signed credential
 * (`sessionCaller`). Calls with no session (background harnesses, the in-app AI SDK tools) still
 * gate, they just have no transcript to surface in.
 *
 * Grants/pendings are in-process (single-user, single-process host) and are lost on restart; the
 * transcript records each request and decision durably (approval-events.ts), so a card whose
 * pending vanished reads as expired rather than offering dead buttons. State lives on
 * `globalThis` because Next.js may evaluate this module once per route bundle: the MCP route
 * registers pendings and the approve route resolves them, and both must see the same maps.
 */
import { randomUUID } from 'node:crypto';
import type { ApprovalPolicy, ApprovalCheckInput, Caller } from '@connectors/engine';
import { isNotifierDelivery } from '@/lib/notifications/caller';
import { publishConnectorApprovals } from '@/lib/realtime/bus';
import { resolveApprovalMode } from './write-policy';

export const GRANT_TTL_MS = 5 * 60_000;

/** What the human chose on the approval card. */
export type ApprovalDecision = 'approve' | 'always' | 'deny';

export interface PendingApproval {
  id: string;
  ownerId: string;
  actionId: string;
  connectionId: string;
  providerId: string;
  /** The connected account the call would act as (email, else label). */
  account: string | null;
  risk: string;
  /** Redacted, schema-parsed input: exactly what the call would do. */
  preview: unknown;
  /** The chat whose agent asked, or null when the call carried no session. */
  sessionId: string | null;
  createdAt: number;
}

export interface ResolvedApproval extends PendingApproval {
  decision: ApprovalDecision;
}

interface InternalPending extends PendingApproval {
  key: string;
}

interface ApprovalState {
  pending: Map<string, InternalPending>;
  /** grant slot (grant key + session) → expiry (ms epoch), single-use */
  grants: Map<string, number>;
}

const STATE_KEY = Symbol.for('@ri/connector-approvals');
const globalRef = globalThis as unknown as { [STATE_KEY]?: ApprovalState };
if (!globalRef[STATE_KEY]) globalRef[STATE_KEY] = { pending: new Map(), grants: new Map() };
const state = globalRef[STATE_KEY]!;

const SESSION_CALLER_PREFIX = 'session:';

/** The caller identity the connectors MCP route stamps on a call made from a chat session. */
export function sessionCaller(sessionId: string): Caller {
  return { type: 'mcp', id: `${SESSION_CALLER_PREFIX}${sessionId}` };
}

/** The chat session a caller identifies, if it came through a session's connectors MCP. */
export function sessionIdFromCaller(caller: Caller | undefined): string | null {
  if (caller?.type !== 'mcp' || !caller.id?.startsWith(SESSION_CALLER_PREFIX)) return null;
  return caller.id.slice(SESSION_CALLER_PREFIX.length) || null;
}

function grantKey(i: ApprovalCheckInput): string {
  return [i.connection.ownerId, i.actionId, i.connection.id, i.inputDigest, i.actionVersion].join('|');
}

/** A grant only matches a retry from the chat whose request was approved. */
function grantSlot(key: string, sessionId: string | null): string {
  return `${key}|${sessionId ?? ''}`;
}

function toPublic(p: InternalPending): PendingApproval {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { key, ...pub } = p;
  return pub;
}

function liveIdsFor(sessionId: string): string[] {
  return [...state.pending.values()]
    .filter((p) => p.sessionId === sessionId)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((p) => p.id);
}

/** Tell the chat's open transcripts which of its approvals are still live. */
export function publishSessionApprovals(sessionId: string | null): void {
  if (sessionId) publishConnectorApprovals(sessionId, liveIdsFor(sessionId));
}

function pruneExpiredGrants(now: number): void {
  for (const [slot, exp] of state.grants) if (exp <= now) state.grants.delete(slot);
}

export interface AppApprovalOptions {
  /** Dev: auto-allow everything so the chat works end-to-end. Production: false → the real gate. */
  autoApprove?: boolean;
  /** A new pending approval: card in the asking chat + notification. Defaults to approval-events. */
  onRequested?: (pending: PendingApproval) => Promise<void>;
  /** Pendings that went moot (see `settleMoot`). Defaults to approval-events. */
  onSettled?: (settled: PendingApproval[]) => Promise<void>;
}

// Dynamic imports break the static approval→events→connector-runtime→approval cycle and keep this
// module free of the DB.
const recordRequested = async (p: PendingApproval) =>
  (await import('./approval-events')).recordApprovalRequested(p);
const recordSettled = async (settled: PendingApproval[]) =>
  (await import('./approval-events')).recordApprovalsSettled(settled);

export function appApprovalPolicy(opts: AppApprovalOptions = {}): ApprovalPolicy {
  const onRequested = opts.onRequested ?? recordRequested;
  const onSettled = opts.onSettled ?? recordSettled;

  /**
   * The same chat just ran the exact call it had been waiting on (the user flipped the action to
   * run without asking in settings, say). Its pending is moot: approving it later would only
   * license a duplicate run, so it leaves the queue and the transcript records how it settled.
   */
  const settleMoot = (key: string, sessionId: string | null): void => {
    const moot = [...state.pending.values()].filter((p) => p.key === key && p.sessionId === sessionId);
    if (moot.length === 0) return;
    for (const p of moot) state.pending.delete(p.id);
    // Record first, then publish, so a card never sees "not live and undecided" (expired) between.
    void onSettled(moot.map(toPublic))
      .catch((err) => console.warn('[connectors] recording settled approvals failed:', err))
      .finally(() => publishSessionApprovals(sessionId));
  };

  return {
    async check(input) {
      // NARROW trusted-dispatch bypass (spec §2.3): the app's own notifier sending a templated
      // delivery via an allowlisted action — never "all app callers". Agent/MCP calls fall through
      // to the real gate below. Must precede the mutating check (delivery actions are mutating).
      if (isNotifierDelivery(input.caller, input.actionId)) return 'allow';
      if (opts.autoApprove) return 'allow';
      if (!input.mutating) return 'allow';
      const key = grantKey(input);
      const sessionId = sessionIdFromCaller(input.caller);
      // Standing intent: reversible, internal writes run on the connection the
      // user already authorized. Outward (send/post/…) and irreversible
      // (high-risk delete/cancel/pay) actions fall through to the human gate,
      // unless the user has explicitly flipped that action to 'auto'.
      if (resolveApprovalMode({ actionId: input.actionId, risk: input.risk, mutating: input.mutating }) === 'auto') {
        settleMoot(key, sessionId);
        return 'allow';
      }
      const now = Date.now();
      pruneExpiredGrants(now);
      const slot = grantSlot(key, sessionId);
      const exp = state.grants.get(slot);
      if (exp && exp > now) {
        state.grants.delete(slot); // single-use
        return 'allow';
      }
      // Register a pending approval for the human to resolve (one per call per chat).
      if (![...state.pending.values()].some((p) => p.key === key && p.sessionId === sessionId)) {
        const pending: InternalPending = {
          id: randomUUID(),
          key,
          ownerId: input.connection.ownerId,
          actionId: input.actionId,
          connectionId: input.connection.id,
          providerId: input.connection.providerId,
          account: input.connection.email ?? input.connection.label ?? null,
          risk: input.risk,
          preview: input.inputPreview,
          sessionId,
          createdAt: now,
        };
        state.pending.set(pending.id, pending);
        publishSessionApprovals(sessionId);
        // Durable transcript card + notification (best-effort).
        void onRequested(toPublic(pending)).catch((err) =>
          console.warn('[connectors] recording approval request failed:', err),
        );
      }
      return 'ask';
    },
  };
}

/** Pending approvals awaiting a human decision, oldest first (UI / route consumes this). */
export function listPendingApprovals(filter: { ownerId?: string; sessionId?: string } = {}): PendingApproval[] {
  return [...state.pending.values()]
    .filter((p) => !filter.ownerId || p.ownerId === filter.ownerId)
    .filter((p) => !filter.sessionId || p.sessionId === filter.sessionId)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(toPublic);
}

/**
 * Resolve pending approvals with the human's decision. `approve` and `always` record a single-use,
 * short-TTL grant the asking chat's retry matches (`always` also flips the action's policy, which
 * the approve route does through the settings store). `deny` just clears them. Ids that no longer
 * exist (resolved elsewhere, or lost to a restart) come back in `missing`.
 *
 * Doesn't publish: the caller records the decision in the transcript first, then calls
 * `publishSessionApprovals` for each affected chat, so a card never sees its request vanish before
 * its decision lands.
 */
export function resolvePendingApprovals(
  ids: readonly string[],
  decision: ApprovalDecision,
): { resolved: ResolvedApproval[]; missing: string[] } {
  const resolved: ResolvedApproval[] = [];
  const missing: string[] = [];
  const now = Date.now();
  for (const id of new Set(ids)) {
    const p = state.pending.get(id);
    if (!p) {
      missing.push(id);
      continue;
    }
    state.pending.delete(id);
    if (decision !== 'deny') state.grants.set(grantSlot(p.key, p.sessionId), now + GRANT_TTL_MS);
    resolved.push({ ...toPublic(p), decision });
  }
  return { resolved, missing };
}

/** Test helper: forget every pending approval and grant. */
export function _resetApprovals(): void {
  state.pending.clear();
  state.grants.clear();
}
