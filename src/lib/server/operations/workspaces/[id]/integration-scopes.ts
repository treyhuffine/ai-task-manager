import { parseIntegrationScopes, validateIntegrationScopes } from '@/lib/integrations/scopes';
import { getWorkspace, setWorkspaceIntegrationScopes } from '@/lib/db/queries';
import { recycleWorkspaceSessions } from '@/lib/executor/adapter';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Replace a workspace's integration allowlist (docs/integrations-workspace-scoping-spec.md §6e/§6f).
 *
 * - Reject toolkit ids that are neither currently registered NOR already stored on this workspace
 *   (a typo / stale client). A *stored* id is kept even if its provider is currently disconnected
 *   (dormant) — disconnect never wipes intent; it resolves to nothing at session-build time.
 * - Each scope's `accounts` may name accounts as exact pins or as identifiers (email, label, account
 *   id) that resolve against the live connections. A stored pin whose account is disconnected is kept
 *   (dormant). Only pins are stored.
 * - After persisting, recycle the workspace's live agent sessions so a removed service takes effect
 *   immediately (the harness caches its tool list otherwise).
 */
export async function PUT(rpcInput: rpcZ.infer<typeof PUTInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  const ws = getWorkspace(id);
  if (!ws) return reply({ error: 'not_found' }, { status: 404 });

  const body = (rpcInput.body) as { scopes?: unknown };
  const incoming = parseIntegrationScopes(body.scopes);
  if (!incoming) {
    return reply(
      { error: 'scopes must be an array of { toolkitId, accounts? }, where each account is an email, label, account id or { accountId, authConfigId? }' },
      { status: 400 },
    );
  }

  const result = await validateIntegrationScopes(incoming, { stored: ws.integrationScopes ?? [] });
  if (!result.ok) return reply({ error: result.error }, { status: 400 });

  const updated = setWorkspaceIntegrationScopes(id, result.scopes);
  await recycleWorkspaceSessions(id); // §6f — tightening applies now, not next session
  return reply({ workspace: updated });
}

export const PUTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "scopes": rpcZ.array(rpcZ.object({ toolkitId: rpcZ.string(), account: rpcZ.union([rpcZ.string(), rpcZ.object({ accountId: rpcZ.string(), authConfigId: rpcZ.string().optional() }).strict()]).optional(), accounts: rpcZ.array(rpcZ.union([rpcZ.string(), rpcZ.object({ accountId: rpcZ.string(), authConfigId: rpcZ.string().optional() }).strict()])).optional() }).strict()).optional() }).strict().default({}) }).strict();
