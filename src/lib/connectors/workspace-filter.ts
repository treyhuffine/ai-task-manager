/**
 * A workspace's connector scopes → the engine projection filters (docs/connectors-workspace-scoping-spec.md
 * §6b). Pure over a runtime handle so it can be tested without the app's connector home.
 * `resolveWorkspaceConnectorFilter` (./runtime) loads the workspace and calls this.
 */
import type { AccountChoice, ConnectorRuntime } from '@connectors/engine';
import { pinMatchesConnection, scopePins } from './scope-pins';
import type { WorkspaceConnectorScope } from '@/db/types';

/** A workspace's connector allowlist, resolved into the engine projection filters. */
export interface WorkspaceConnectorFilter {
  /** Toolkit ids to expose: scoped ∩ connected. */
  toolkits: string[];
  /** Toolkits pinned to exactly one live connection (the model never chooses an account). */
  connectionPins: Record<string, string>;
  /** Toolkits limited to a set of 2+ live connections (the model chooses, only within the set). */
  allowedAccounts: Record<string, AccountChoice[]>;
}

/**
 * Each scope's account pins (stable `accountId` + `authConfigId`) resolve to the owner's live
 * connections for that toolkit's provider: no pins → every account, one live match → a hard pin,
 * two or more → an allowed set. Fail-closed: a scope whose toolkit is unknown/disconnected is
 * dropped, a pin that doesn't resolve to EXACTLY one connection contributes nothing, and a scope
 * whose pins resolve to nothing is not exposed at all (never widened to every account).
 */
export async function resolveConnectorFilter(
  scopes: WorkspaceConnectorScope[],
  runtime: Pick<ConnectorRuntime, 'listConnections' | 'listAccountChoices' | 'getToolkits'>,
  ownerId: string,
): Promise<WorkspaceConnectorFilter> {
  const filter: WorkspaceConnectorFilter = { toolkits: [], connectionPins: {}, allowedAccounts: {} };
  if (scopes.length === 0) return filter;

  const connections = await runtime.listConnections({ ownerId });
  const connectedProviders = new Set(connections.map((c) => c.providerId));
  const toolkitsById = new Map(runtime.getToolkits().map((t) => [t.id, t]));
  const choicesByProvider = new Map<string, AccountChoice[]>();

  for (const scope of scopes) {
    const toolkit = toolkitsById.get(scope.toolkitId);
    if (!toolkit) continue; // unknown / dormant (e.g. an MCP server not currently ingested)
    if (!connectedProviders.has(toolkit.providerId)) continue; // provider disconnected → dormant
    const pins = scopePins(scope);
    if (pins.length > 0) {
      const ids = new Set<string>();
      for (const pin of pins) {
        const matches = connections.filter((c) => c.providerId === toolkit.providerId && pinMatchesConnection(pin, c));
        if (matches.length === 1) ids.add(matches[0]!.id); // unresolvable / ambiguous pin → contributes nothing
      }
      if (ids.size === 0) continue; // no pinned account is live → fail closed, never widen
      if (ids.size === 1) {
        filter.connectionPins[scope.toolkitId] = [...ids][0]!;
      } else {
        let choices = choicesByProvider.get(toolkit.providerId);
        if (!choices) {
          choices = await runtime.listAccountChoices(toolkit.providerId, { ownerId });
          choicesByProvider.set(toolkit.providerId, choices);
        }
        filter.allowedAccounts[scope.toolkitId] = choices.filter((c) => ids.has(c.connectionId));
      }
    }
    filter.toolkits.push(scope.toolkitId);
  }
  return filter;
}
