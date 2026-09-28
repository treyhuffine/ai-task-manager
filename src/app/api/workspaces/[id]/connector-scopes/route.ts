import { NextRequest, NextResponse } from 'next/server';
import { getWorkspace, setWorkspaceConnectorScopes } from '@/lib/db/queries';
import { parseConnectorScopes, validateConnectorScopes } from '@/lib/connectors/scopes';
import { recycleWorkspaceSessions } from '@/lib/executor/adapter';

/**
 * Replace a workspace's connector allowlist (docs/connectors-workspace-scoping-spec.md §6e/§6f).
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
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = getWorkspace(id);
  if (!ws) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { scopes?: unknown };
  const incoming = parseConnectorScopes(body.scopes);
  if (!incoming) {
    return NextResponse.json(
      { error: 'scopes must be an array of { toolkitId, accounts? }, where each account is an email, label, account id or { accountId, authConfigId? }' },
      { status: 400 },
    );
  }

  const result = await validateConnectorScopes(incoming, { stored: ws.connectorScopes ?? [] });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  const updated = setWorkspaceConnectorScopes(id, result.scopes);
  await recycleWorkspaceSessions(id); // §6f — tightening applies now, not next session
  return NextResponse.json({ workspace: updated });
}
