import { NextRequest, NextResponse } from 'next/server';
import { getConnectorRuntime } from '@/lib/connectors/runtime';
import { withCompression } from '@/lib/api/compression';
import {
  defaultApprovalMode,
  isOutwardAction,
  resolveApprovalMode,
  getActionOverride,
  setActionOverride,
  type ApprovalMode,
} from '@/lib/connectors/write-policy';
import type { RiskLevel } from '@connectors/engine';

/**
 * Read (GET) and set (POST) the write-approval policy: for every mutating
 * connector action, whether it runs on standing intent ('auto') or pauses for a
 * per-call human approval ('ask'). The default splits reversible/internal writes
 * (auto) from outward + irreversible ones (ask); a per-action override flips it.
 */
export const GET = withCompression(handleGET);

async function handleGET() {
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
  return NextResponse.json({ toolkits });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { actionId?: unknown; mode?: unknown };
  const actionId = typeof body.actionId === 'string' ? body.actionId : '';
  if (!actionId) return NextResponse.json({ error: 'actionId required' }, { status: 400 });
  const mode: ApprovalMode | null =
    body.mode === 'auto' ? 'auto' : body.mode === 'ask' ? 'ask' : body.mode === null ? null : undefined!;
  if (mode === undefined) return NextResponse.json({ error: "mode must be 'auto', 'ask', or null" }, { status: 400 });
  setActionOverride(actionId, mode);
  return NextResponse.json({ ok: true, actionId, override: getActionOverride(actionId) ?? null });
}
