/** Sensible defaults for the optional injections (§10). */
import type { ApprovalPolicy, Clock, Connection, ConnectionMetadata, Logger } from './types';

export const systemClock: Clock = { now: () => Date.now() };

export const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/**
 * Safe-by-default approval (§8): non-mutating reads run; mutating actions are
 * deferred to a human (`ask`). Hosts override with their own policy — interactive
 * for app calls, grant-remembering for the agent retry loop.
 */
export function defaultApprovalPolicy(): ApprovalPolicy {
  return {
    async check(input) {
      return input.mutating ? 'ask' : 'allow';
    },
  };
}

export function connectionMetadata(c: Connection): ConnectionMetadata {
  return {
    id: c.id,
    ownerId: c.ownerId,
    providerId: c.providerId,
    accountId: c.accountId,
    ...(c.email !== undefined ? { email: c.email } : {}),
    ...(c.label !== undefined ? { label: c.label } : {}),
    scopes: c.scopes,
  };
}

export function uniqueScopes(...lists: (string[] | undefined)[]): string[] {
  const set = new Set<string>();
  for (const list of lists) for (const s of list ?? []) set.add(s);
  return [...set];
}
