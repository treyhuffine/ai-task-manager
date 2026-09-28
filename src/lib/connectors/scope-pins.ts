/**
 * Pure helpers for a workspace connector scope's account set (docs/connectors-workspace-scoping-spec.md
 * §4). No server imports, so the picker UI, the query layer, validation and the runtime filter all
 * read a scope the same way.
 *
 * A scope's `accounts` is a set of pins, each `(accountId, authConfigId?)`:
 *   - empty → every connected account of the service, including ones connected later
 *   - one pin → hard-pinned to that account
 *   - two or more → the agent may choose, but only within the set
 * Rows written before multi-account scopes carry a single legacy `account` pin instead. `scopePins`
 * reads both, and `normalizeConnectorScopes` rewrites a list into the current shape.
 */
import type { WorkspaceConnectorScope, WorkspaceConnectorScopeAccount } from '@/db/types';

/** Stable identity of a pin. `authConfigId` undefined means the provider's default client. */
export function pinKey(pin: WorkspaceConnectorScopeAccount): string {
  return `${pin.accountId}\u0000${pin.authConfigId ?? ''}`;
}

/**
 * Whether a connection is the one a pin names. A pin carries `authConfigId` as well as `accountId`
 * because the same account connected through two OAuth clients yields two connections that share
 * an `accountId`. Match on both.
 */
export function pinMatchesConnection(
  pin: WorkspaceConnectorScopeAccount,
  conn: { accountId: string; authConfigId?: string | null },
): boolean {
  return conn.accountId === pin.accountId && (conn.authConfigId ?? undefined) === (pin.authConfigId ?? undefined);
}

/** The pin that names this connection. */
export function pinOfConnection(conn: { accountId: string; authConfigId?: string | null }): WorkspaceConnectorScopeAccount {
  return { accountId: conn.accountId, ...(conn.authConfigId ? { authConfigId: conn.authConfigId } : {}) };
}

/** A well-formed pin or null. Tolerates a null `authConfigId` (JSON for "default client"). */
function asPin(raw: unknown): WorkspaceConnectorScopeAccount | null {
  if (!raw || typeof raw !== 'object') return null;
  const { accountId, authConfigId } = raw as { accountId?: unknown; authConfigId?: unknown };
  if (typeof accountId !== 'string' || !accountId) return null;
  if (authConfigId !== undefined && authConfigId !== null && typeof authConfigId !== 'string') return null;
  return { accountId, ...(authConfigId ? { authConfigId } : {}) };
}

/** Drop duplicate pins, keeping first-seen order. */
export function dedupePins(pins: WorkspaceConnectorScopeAccount[]): WorkspaceConnectorScopeAccount[] {
  return [...new Map(pins.map((p) => [pinKey(p), p])).values()];
}

/**
 * The account pins a scope limits its service to. Empty = all accounts. Reads the current
 * `accounts` list plus the legacy single `account` pin, deduped. Malformed entries are skipped here,
 * so callers that must fail closed on a malformed row use `normalizeConnectorScopes`.
 */
export function scopePins(scope: WorkspaceConnectorScope): WorkspaceConnectorScopeAccount[] {
  const raw: unknown[] = [...(Array.isArray(scope.accounts) ? scope.accounts : []), ...(scope.account ? [scope.account] : [])];
  return dedupePins(raw.map(asPin).filter((p): p is WorkspaceConnectorScopeAccount => p !== null));
}

/**
 * Rewrite a stored scope list into the current shape: `{ toolkitId, accounts? }`, legacy `account`
 * folded into `accounts`, duplicates removed, unknown fields dropped. Fails closed: a scope that
 * declared account pins but has none that parse is dropped rather than widened to all accounts.
 */
export function normalizeConnectorScopes(scopes: readonly WorkspaceConnectorScope[] | null | undefined): WorkspaceConnectorScope[] {
  if (!Array.isArray(scopes)) return [];
  const out: WorkspaceConnectorScope[] = [];
  for (const scope of scopes) {
    if (!scope || typeof scope.toolkitId !== 'string' || !scope.toolkitId) continue;
    const declared = (Array.isArray(scope.accounts) && scope.accounts.length > 0) || !!scope.account;
    const pins = scopePins(scope);
    if (declared && pins.length === 0) continue;
    out.push({ toolkitId: scope.toolkitId, ...(pins.length > 0 ? { accounts: pins } : {}) });
  }
  return out;
}
