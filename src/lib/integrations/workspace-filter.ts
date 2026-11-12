/**
 * A workspace's integration scopes → the engine projection filters (docs/integrations-workspace-scoping-spec.md
 * §6b). Pure over a runtime handle so it can be tested without the app's integration home.
 * `resolveWorkspaceIntegrationFilter` (./runtime) loads the workspace and calls this.
 */
import type { AccountChoice, IntegrationRuntime } from '@integrations/engine';
import { pinMatchesConnection, scopePins } from './scope-pins';
import { parseManagedToolkitId } from './sources/applications';
import type { WorkspaceIntegrationScope } from '@/db/types';
import { appPlaceAccountId, isAppToolkitId, type McpAppPlace } from './mcp-servers';

/** A workspace's integration allowlist, resolved into the engine projection filters. */
export interface WorkspaceIntegrationFilter {
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
export async function resolveIntegrationFilter(
  scopes: WorkspaceIntegrationScope[],
  runtime: Pick<IntegrationRuntime, 'listConnections' | 'listAccountChoices' | 'getToolkits'>,
  ownerId: string,
  /** The agent these scopes belong to. A personal app is used only through that agent's own connection. */
  workspaceId?: string,
): Promise<WorkspaceIntegrationFilter> {
  const filter: WorkspaceIntegrationFilter = { toolkits: [], connectionPins: {}, allowedAccounts: {} };
  if (scopes.length === 0) return filter;

  const connections = await runtime.listConnections({ ownerId });
  const connectedProviders = new Set(connections.map((c) => c.providerId));
  const toolkitsById = new Map(runtime.getToolkits().map((t) => [t.id, t]));
  const choicesByProvider = new Map<string, AccountChoice[]>();

  for (const scope of scopes) {
    const toolkit = toolkitsById.get(scope.toolkitId);
    if (!toolkit) continue; // unknown / dormant (e.g. an MCP server not currently ingested)
    if (!connectedProviders.has(toolkit.providerId)) continue; // provider disconnected → dormant
    // A personal app: only this agent's own connection, whatever the scope's pins say, so one
    // agent never uses the access the app's consent screen gave another (docs/personal-apps.md).
    if (isAppToolkitId(scope.toolkitId)) {
      if (!workspaceId) continue;
      const own = placeConnection(connections, toolkit.providerId, { kind: 'agent', workspaceId });
      if (!own) continue;
      filter.connectionPins[scope.toolkitId] = own;
      filter.toolkits.push(scope.toolkitId);
      continue;
    }
    const pins = scopePins(scope);
    // A managed source's toolkit is only ever granted on named accounts. A stored scope without
    // any (written before that rule, or by hand) grants nothing rather than every account.
    if (pins.length === 0 && parseManagedToolkitId(scope.toolkitId)) continue;
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

/** The live connection an app has for a place, if it has one. */
function placeConnection(connections: readonly { id: string; providerId: string; accountId: string; status?: string }[], providerId: string, place: McpAppPlace): string | undefined {
  const accountId = appPlaceAccountId(place);
  return connections.find((c) => c.providerId === providerId && c.accountId === accountId)?.id;
}

/**
 * Ri's own chats (its main chat, task and note chats, background work): every connected toolkit,
 * with each personal app pinned to its connection for Ri itself. An app with no such connection is
 * left out, never reached through an agent's.
 */
export async function resolveRiIntegrationFilter(
  runtime: Pick<IntegrationRuntime, 'listConnections' | 'getToolkits'>,
  ownerId: string,
): Promise<{ toolkits: string[]; connectionPins: Record<string, string> }> {
  const connections = await runtime.listConnections({ ownerId });
  const connected = new Set(connections.map((c) => c.providerId));
  const toolkits: string[] = [];
  const connectionPins: Record<string, string> = {};
  for (const toolkit of runtime.getToolkits()) {
    if (!connected.has(toolkit.providerId)) continue;
    if (isAppToolkitId(toolkit.id)) {
      const own = placeConnection(connections, toolkit.providerId, { kind: 'ri' });
      if (!own) continue;
      connectionPins[toolkit.id] = own;
    }
    toolkits.push(toolkit.id);
  }
  return { toolkits, connectionPins };
}
