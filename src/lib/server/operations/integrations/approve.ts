import { INTEGRATION_LABELS } from '@/constants/integrations';
import {
  listPendingApprovals,
  publishSessionApprovals,
  resolvePendingApprovals,
  type ApprovalDecision,
} from '@/lib/integrations/approval';
import { allowWithoutAsking, recordApprovalDecision } from '@/lib/integrations/approval-events';
import { SESSION_CREDENTIAL_HEADER } from '@/lib/orchestrator/session-credential';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Resolve pending integration approvals: the user's answer from an approval card in chat.
 *
 * Body: `{ ids: string[], decision: 'approve' | 'always' | 'deny' }`.
 *   - `approve` records a single-use, short-TTL grant keyed on the exact (ownerId, action,
 *     connection, inputDigest, actionVersion) and the asking chat, so that chat's retry of the same
 *     call passes the gate;
 *   - `always` additionally stops asking for that action, through the same setting the Integrations
 *     screen shows (so it can be turned back there);
 *   - `deny` just clears them.
 * Either way the decision is written into the asking chat's transcript and the waiting agent is
 * told, so it retries or stands down without the user typing anything (approval-events.ts).
 * The legacy single form `{ id, decision: 'allow' | 'deny' }` still works.
 *
 * Human-only. No orchestrator action or integration tool reaches this, and a request carrying an
 * agent session credential (the header every harness session's app calls carry) is refused, so an
 * agent can't approve its own request through the app's own plumbing.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  if (request.headers.get(SESSION_CREDENTIAL_HEADER)) {
    return reply({ error: `${INTEGRATION_LABELS.singular} approvals are answered by the user, not by an agent.` }, { status: 403 });
  }

  const body = (rpcInput.body) as { id?: unknown; ids?: unknown; decision?: unknown };
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : typeof body.id === 'string' && body.id
      ? [body.id]
      : [];
  if (ids.length === 0) return reply({ error: 'ids required' }, { status: 400 });
  const decision: ApprovalDecision | null =
    body.decision === 'deny'
      ? 'deny'
      : body.decision === 'always'
        ? 'always'
        : body.decision === 'approve' || body.decision === 'allow'
          ? 'approve'
          : null;
  if (!decision) {
    return reply({ error: "decision must be 'approve', 'always', or 'deny'" }, { status: 400 });
  }

  if (listPendingApprovals().some(item => ids.includes(item.id) && item.localApp)) {
    return reply({ error: 'Answer app approvals in the native app approval card.' }, { status: 409 });
  }

  if (decision === 'always') {
    // Flip the policy before resolving, so a failure leaves the approvals pending and retryable.
    const wanted = new Set(ids);
    const actions = new Map<string, string>();
    for (const p of listPendingApprovals()) if (wanted.has(p.id)) actions.set(p.actionId, p.risk);
    try {
      for (const [actionId, risk] of actions) await allowWithoutAsking(actionId, risk);
    } catch (err) {
      return reply({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  const { resolved, missing } = resolvePendingApprovals(ids, decision);
  if (resolved.length === 0) {
    return reply({ error: 'These approvals are no longer pending.', missing }, { status: 404 });
  }
  try {
    await recordApprovalDecision(resolved, decision);
  } catch (err) {
    // The decision itself stands (the grants exist). Only the transcript note or wake-up failed.
    console.error(`[integrations/approve] recording the decision failed:`, err);
  } finally {
    // After the decision rows, so an open card goes straight from pending to decided.
    for (const sessionId of new Set(resolved.map((p) => p.sessionId))) publishSessionApprovals(sessionId);
  }
  return reply({ ok: true, decision, resolved: resolved.map((p) => p.id), missing });
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({ "id": rpcZ.string().optional(), "ids": rpcZ.array(rpcZ.string()).optional(), "decision": rpcZ.string().optional() }).strict().default({}) }).strict();
