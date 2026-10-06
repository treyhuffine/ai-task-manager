/**
 * Integration scope parsing + validation shared by the create (POST /workspaces) and edit
 * (PUT /workspaces/:id/integration-scopes) surfaces, so both behave identically
 * (docs/integrations-workspace-scoping-spec.md §6e). The UI only ever surfaces connected services +
 * accounts, but these guard against malformed / stale / hostile payloads on either path.
 *
 * A write payload names a scope's accounts either as exact pins (`{ accountId, authConfigId? }`, what
 * the UI and `get_workspace` carry) or as plain identifiers (an email, label, account id, or the
 * "email (Client)" display form an agent sees), which validation resolves against the owner's live
 * connections. Only pins are ever stored.
 */
import { INTEGRATION_LABELS } from '@/constants/integrations';
import { accountDisplay } from '@integrations/engine';
import { getIntegrationOwnerId, getIntegrationRuntime } from './runtime';
import { dedupePins, pinKey, pinMatchesConnection, pinOfConnection, scopePins } from './scope-pins';
import type { WorkspaceIntegrationScope, WorkspaceIntegrationScopeAccount } from '@/db/types';

/** One account in a scope write: an exact pin, or an identifier resolved against live connections. */
export type IntegrationScopeAccountRef = WorkspaceIntegrationScopeAccount | string;

/** A parsed (not yet validated) scope entry from a write payload. */
export interface IntegrationScopeInput {
  toolkitId: string;
  /** Omitted = all accounts, including ones connected later. */
  accounts?: IntegrationScopeAccountRef[];
}

/** Parse one account ref, or `null` when malformed. */
function parseAccountRef(raw: unknown): IntegrationScopeAccountRef | null {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const { accountId, authConfigId } = raw as { accountId?: unknown; authConfigId?: unknown };
  if (typeof accountId !== 'string' || !accountId) return null;
  if (authConfigId !== undefined && authConfigId !== null && typeof authConfigId !== 'string') return null;
  return { accountId, ...(authConfigId ? { authConfigId } : {}) };
}

const refKey = (ref: IntegrationScopeAccountRef): string => (typeof ref === 'string' ? `s:${ref}` : `p:${pinKey(ref)}`);

/**
 * Coerce a raw client payload into scope entries. Returns `null` (the caller answers 400) unless the
 * payload is an array of `{ toolkitId: string, accounts?: AccountRef[], account?: AccountRef | null }`.
 * The legacy single `account` is folded into `accounts`. Unknown fields are dropped. A malformed
 * account ref rejects the whole payload: silently dropping it would widen the scope to every
 * account, which is the opposite of what the caller asked for.
 */
export function parseIntegrationScopes(raw: unknown): IntegrationScopeInput[] | null {
  if (!Array.isArray(raw)) return null;
  const out: IntegrationScopeInput[] = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') return null;
    const e = s as { toolkitId?: unknown; accounts?: unknown; account?: unknown };
    if (typeof e.toolkitId !== 'string' || !e.toolkitId) return null;

    const rawRefs: unknown[] = [];
    if (e.accounts !== undefined && e.accounts !== null) {
      if (!Array.isArray(e.accounts)) return null;
      rawRefs.push(...e.accounts);
    }
    if (e.account !== undefined && e.account !== null) rawRefs.push(e.account);

    const refs: IntegrationScopeAccountRef[] = [];
    for (const r of rawRefs) {
      const ref = parseAccountRef(r);
      if (!ref) return null;
      refs.push(ref);
    }
    const unique = [...new Map(refs.map((r) => [refKey(r), r])).values()];
    out.push({ toolkitId: e.toolkitId, ...(unique.length > 0 ? { accounts: unique } : {}) });
  }
  return out;
}

/** A connection as validation sees it, with its model-facing display token. */
interface AccountCandidate {
  accountId: string;
  authConfigId?: string;
  email?: string;
  label?: string;
  display: string;
}

const quoteList = (xs: string[]): string => xs.map((x) => `"${x}"`).join(', ');

/**
 * Resolve an identifier to exactly one candidate: its account id, email, label, or display form
 * ("me@x.com (Work)"). Case-insensitive, since emails are. Returns every match so the caller can
 * tell "none" from "ambiguous".
 */
function matchIdentifier(ref: string, candidates: AccountCandidate[]): AccountCandidate[] {
  const needle = ref.toLowerCase();
  return candidates.filter((c) =>
    [c.accountId, c.email, c.label, c.display].some((t) => typeof t === 'string' && t.toLowerCase() === needle),
  );
}

/**
 * Validate + dedupe scopes against the live integration runtime, resolving account identifiers to
 * pins. Rejects:
 *  - toolkit ids that are neither currently registered nor already stored (a typo / stale client);
 *  - for a currently-connected provider, a pin that matches more than one connection, or a NEW pin
 *    that matches none (a pin already stored on this workspace is kept as a dormant account);
 *  - an identifier that matches no connected account, or more than one.
 * Pins for disconnected (dormant) or not-yet-registered services are left untouched so disconnect
 * never wipes intent. Picking every connected account stores that explicit set, which does NOT
 * include accounts connected later. Only a scope with no accounts means "all accounts".
 */
export async function validateIntegrationScopes(
  incoming: IntegrationScopeInput[],
  opts: { stored?: WorkspaceIntegrationScope[] } = {},
): Promise<{ ok: true; scopes: WorkspaceIntegrationScope[] } | { ok: false; error: string }> {
  const runtime = await getIntegrationRuntime();
  const toolkitsById = new Map(runtime.getToolkits().map((t) => [t.id, t]));
  const storedScopes = opts.stored ?? [];
  const storedToolkits = new Set(storedScopes.map((s) => s.toolkitId));

  const unknown = incoming
    .filter((s) => !toolkitsById.has(s.toolkitId) && !storedToolkits.has(s.toolkitId))
    .map((s) => s.toolkitId);
  if (unknown.length > 0) {
    return { ok: false, error: `unknown ${INTEGRATION_LABELS.singular.toLowerCase()} service(s): ${unknown.join(', ')}` };
  }

  const ownerId = getIntegrationOwnerId();
  const connections = await runtime.listConnections({ ownerId });
  const candidatesByProvider = new Map<string, AccountCandidate[]>();
  const candidatesFor = async (providerId: string): Promise<AccountCandidate[]> => {
    const cached = candidatesByProvider.get(providerId);
    if (cached) return cached;
    const choices = new Map((await runtime.listAccountChoices(providerId, { ownerId })).map((c) => [c.connectionId, c]));
    const list = connections
      .filter((c) => c.providerId === providerId)
      .map((c) => {
        const choice = choices.get(c.id);
        return {
          accountId: c.accountId,
          ...(c.authConfigId ? { authConfigId: c.authConfigId } : {}),
          ...(c.email ? { email: c.email } : {}),
          ...(c.label ? { label: c.label } : {}),
          display: (choice && accountDisplay(choice)) || c.email || c.label || c.accountId,
        };
      });
    candidatesByProvider.set(providerId, list);
    return list;
  };

  const out: WorkspaceIntegrationScope[] = [];
  for (const s of incoming) {
    if (!s.accounts || s.accounts.length === 0) {
      out.push({ toolkitId: s.toolkitId });
      continue;
    }
    const tk = toolkitsById.get(s.toolkitId);
    const candidates = tk ? await candidatesFor(tk.providerId) : [];
    const storedPins = storedScopes.filter((x) => x.toolkitId === s.toolkitId).flatMap(scopePins);
    const storedKeys = new Set(storedPins.map(pinKey));
    const name = tk?.displayName ?? s.toolkitId;
    const pins: WorkspaceIntegrationScopeAccount[] = [];

    for (const ref of s.accounts) {
      if (typeof ref === 'string') {
        if (candidates.length === 0) {
          // Nothing live to resolve against. An identifier that names a stored (dormant) pin by its
          // account id still round-trips, so re-sending the current scopes never fails.
          const dormant = storedPins.filter((p) => p.accountId === ref);
          if (dormant.length === 1) {
            pins.push(dormant[0]!);
            continue;
          }
          return { ok: false, error: `can't use account "${ref}" for ${name}: no ${name} account is connected` };
        }
        const matches = matchIdentifier(ref, candidates);
        if (matches.length === 0) {
          return {
            ok: false,
            error: `no connected ${name} account matches "${ref}". Connected: ${quoteList(candidates.map((c) => c.display))}`,
          };
        }
        if (matches.length > 1) {
          return {
            ok: false,
            error: `"${ref}" matches more than one connected ${name} account. Use one of: ${quoteList(matches.map((c) => c.display))}`,
          };
        }
        pins.push(pinOfConnection(matches[0]!));
        continue;
      }

      // An exact pin. Dormant (service unregistered or provider disconnected) → kept as-is.
      if (!tk || candidates.length === 0) {
        pins.push(ref);
        continue;
      }
      const matches = candidates.filter((c) => pinMatchesConnection(ref, c));
      if (matches.length > 1) {
        return { ok: false, error: `account pin for "${s.toolkitId}" does not resolve to a unique connected account` };
      }
      if (matches.length === 0 && !storedKeys.has(pinKey(ref))) {
        return { ok: false, error: `account pin for "${s.toolkitId}" does not resolve to a unique connected account` };
      }
      pins.push(ref); // one live match, or a stored pin whose account is currently disconnected
    }

    out.push({ toolkitId: s.toolkitId, accounts: dedupePins(pins) });
  }

  // Dedupe by toolkitId (last wins).
  return { ok: true, scopes: [...new Map(out.map((s) => [s.toolkitId, s])).values()] };
}
