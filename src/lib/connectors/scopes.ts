/**
 * Connector scope parsing + validation shared by the create (POST /workspaces) and edit
 * (PUT /workspaces/:id/connector-scopes) surfaces, so both behave identically
 * (docs/connectors-workspace-scoping-spec.md §6e). The UI only ever surfaces connected services +
 * accounts, but these guard against malformed / stale / hostile payloads on either path.
 */
import { getConnectorRuntime } from './runtime';
import type { WorkspaceConnectorScope } from '@/db/types';

/**
 * Coerce a raw client payload into well-formed scope entries. Returns `null` if the payload isn't an
 * array of `{ toolkitId: string, account?: { accountId: string, authConfigId?: string } }`. Unknown
 * fields are dropped; a malformed `account` is dropped (treated as "all accounts") rather than
 * failing the whole request.
 */
export function parseConnectorScopes(raw: unknown): WorkspaceConnectorScope[] | null {
  if (!Array.isArray(raw)) return null;
  const out: WorkspaceConnectorScope[] = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') return null;
    const e = s as { toolkitId?: unknown; account?: unknown };
    if (typeof e.toolkitId !== 'string' || !e.toolkitId) return null;
    let account: WorkspaceConnectorScope['account'];
    if (e.account && typeof e.account === 'object') {
      const a = e.account as { accountId?: unknown; authConfigId?: unknown };
      if (typeof a.accountId === 'string' && a.accountId) {
        account = {
          accountId: a.accountId,
          ...(typeof a.authConfigId === 'string' && a.authConfigId ? { authConfigId: a.authConfigId } : {}),
        };
      }
    }
    out.push({ toolkitId: e.toolkitId, ...(account ? { account } : {}) });
  }
  return out;
}

/**
 * Validate + dedupe scopes against the live connector runtime. Rejects toolkit ids that are neither
 * currently registered nor already stored (a typo / stale client), and account pins that — for a
 * currently-connected provider — don't resolve to exactly one connection. Pins for disconnected
 * (dormant) or not-yet-registered services are left untouched so disconnect never wipes intent.
 */
export async function validateConnectorScopes(
  incoming: WorkspaceConnectorScope[],
  opts: { stored?: WorkspaceConnectorScope[] } = {},
): Promise<{ ok: true; scopes: WorkspaceConnectorScope[] } | { ok: false; error: string }> {
  const runtime = await getConnectorRuntime();
  const toolkitsById = new Map(runtime.getToolkits().map((t) => [t.id, t]));
  const stored = new Set((opts.stored ?? []).map((s) => s.toolkitId));

  const unknown = incoming
    .filter((s) => !toolkitsById.has(s.toolkitId) && !stored.has(s.toolkitId))
    .map((s) => s.toolkitId);
  if (unknown.length > 0) {
    return { ok: false, error: `unknown connector service(s): ${unknown.join(', ')}` };
  }

  const connections = await runtime.listConnections();
  for (const s of incoming) {
    if (!s.account) continue;
    const tk = toolkitsById.get(s.toolkitId);
    if (!tk) continue; // stored-but-unregistered (dormant) → don't validate
    if (!connections.some((c) => c.providerId === tk.providerId)) continue; // provider disconnected → dormant
    const matches = connections.filter(
      (c) =>
        c.providerId === tk.providerId &&
        c.accountId === s.account!.accountId &&
        (c.authConfigId ?? undefined) === (s.account!.authConfigId ?? undefined),
    );
    if (matches.length !== 1) {
      return { ok: false, error: `account pin for "${s.toolkitId}" does not resolve to a unique connected account` };
    }
  }

  // Dedupe by toolkitId (last wins).
  return { ok: true, scopes: [...new Map(incoming.map((s) => [s.toolkitId, s])).values()] };
}
