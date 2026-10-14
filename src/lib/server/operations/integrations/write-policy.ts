import { getIntegrationRuntime, getMcpServerStore } from '@/lib/integrations/runtime';
import { mcpToolApprovalOverride } from '@/lib/integrations/mcp-approval-policy';
import {
  defaultApprovalMode,
  getActionOverride,
  isOutwardAction,
  resolveApprovalMode,
  setActionOverride,
  type ApprovalMode,
} from '@/lib/integrations/write-policy';
import { reply, type OperationContext } from '@/lib/server/operation';
import type { RiskLevel } from '@integrations/engine';
import { z as rpcZ } from 'zod/v4';

/**
 * Read (GET) and set (POST) the write-approval policy: for every mutating
 * integration action, whether it runs on standing intent ('auto') or pauses for a
 * per-call human approval ('ask'). The default splits reversible/internal writes
 * (auto) from outward + irreversible ones (ask); a per-action override flips it.
 */

export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const runtime = await getIntegrationRuntime();
  const hosted = getMcpServerStore().list().filter(server => server.enabled && server.providerId);
  const toolkits = runtime
    .getToolkits()
    .map((t) => {
      const actions = t.actions
        .filter((a) => a.mutating)
        .map((a) => {
          const risk = (a.risk ?? 'medium') as RiskLevel;
          const facts = { actionId: a.id, risk, mutating: true };
          const override = getActionOverride(a.id);
          const defaultMode = defaultApprovalMode(facts);
          const accountOverrides = hosted.filter(server => server.providerId === t.providerId && a.id.startsWith(`${server.providerId}.`))
            .map(server => mcpToolApprovalOverride(server.toolOverrides?.[a.id.slice(server.providerId!.length + 1)]));
          const legacyChoice = accountOverrides.some(mode => mode !== undefined);
          const inheritedMode = legacyChoice
            ? accountOverrides.some(mode => (mode ?? defaultMode) === 'ask') ? 'ask' : 'auto'
            : resolveApprovalMode(facts);
          return {
            id: a.id,
            description: a.description ?? '',
            risk,
            outward: isOutwardAction(a.id),
            defaultMode,
            mode: override ?? inheritedMode,
            overridden: override !== undefined || legacyChoice,
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
  // A provider-wide choice replaces older account-level approval preferences.
  // Clearing them restores the native default without changing mutation facts.
  const servers = getMcpServerStore();
  for (const server of servers.list()) if (server.providerId && actionId.startsWith(`${server.providerId}.`)) {
    const tool = actionId.slice(server.providerId.length + 1);
    if (mcpToolApprovalOverride(server.toolOverrides?.[tool]) !== undefined) {
      await servers.update(server.id, { toolOverrides: { [tool]: { approvalMode: null } } });
    }
  }
  setActionOverride(actionId, mode);
  return reply({ ok: true, actionId, override: getActionOverride(actionId) ?? null });
}

export const GETInput = rpcZ.object({}).strict().default({});
export const POSTInput = rpcZ.object({ body: rpcZ.object({ "actionId": rpcZ.string().optional(), "mode": rpcZ.enum(["auto", "ask"]).nullable().optional() }).strict().default({}) }).strict();
