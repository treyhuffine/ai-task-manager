import { getConnectorRuntime } from '@/lib/connectors/runtime';
import {
  defaultApprovalMode,
  getActionOverride,
  isOutwardAction,
  resolveApprovalMode,
  setActionOverride,
  type ApprovalMode,
} from '@/lib/connectors/write-policy';
import { reply, type OperationContext } from '@/lib/server/operation';
import type { RiskLevel } from '@connectors/engine';
import { z as rpcZ } from 'zod/v4';

/**
 * Read (GET) and set (POST) the write-approval policy: for every mutating
 * connector action, whether it runs on standing intent ('auto') or pauses for a
 * per-call human approval ('ask'). The default splits reversible/internal writes
 * (auto) from outward + irreversible ones (ask); a per-action override flips it.
 */

export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const runtime = await getConnectorRuntime();
  const toolkits = runtime
    .getToolkits()
    .map((t) => {
      const actions = t.actions
        .filter((a) => a.mutating)
        .map((a) => {
          const risk = (a.risk ?? 'medium') as RiskLevel;
          const facts = { actionId: a.id, risk, mutating: true };
          const override = getActionOverride(a.id);
          return {
            id: a.id,
            description: a.description ?? '',
            risk,
            outward: isOutwardAction(a.id),
            defaultMode: defaultApprovalMode(facts),
            mode: resolveApprovalMode(facts),
            overridden: override !== undefined,
          };
        });
      return { id: t.id, displayName: t.displayName, providerId: t.providerId, actions };
    })
    .filter((t) => t.actions.length > 0);
  return reply({ toolkits });
}

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  const body = (rpcInput.body) as { actionId?: unknown; mode?: unknown };
  const actionId = typeof body.actionId === 'string' ? body.actionId : '';
  if (!actionId) return reply({ error: 'actionId required' }, { status: 400 });
  const mode: ApprovalMode | null =
    body.mode === 'auto' ? 'auto' : body.mode === 'ask' ? 'ask' : body.mode === null ? null : undefined!;
  if (mode === undefined) return reply({ error: "mode must be 'auto', 'ask', or null" }, { status: 400 });
  setActionOverride(actionId, mode);
  return reply({ ok: true, actionId, override: getActionOverride(actionId) ?? null });
}

export const GETInput = rpcZ.object({}).strict().default({});
export const POSTInput = rpcZ.object({ body: rpcZ.object({ "actionId": rpcZ.string().optional(), "mode": rpcZ.enum(["auto", "ask"]).nullable().optional() }).strict().default({}) }).strict();
