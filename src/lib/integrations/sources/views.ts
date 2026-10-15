/**
 * What Connectors shows for managed accounts: one row per account, with the application, the
 * source it goes through, the verified identity beside the user's label, its health and whether
 * Ri's Calendar reads it. No remote ids beyond what the UI needs to act on the row.
 */
import { APPLICATIONS } from './applications';
import { listManagedConnections, managedConfig } from './managed-connections';
import { currentPreferences } from './preferences';
import type { ApplicationId, SourceEntry } from './types';

export interface ManagedAccountView {
  connectionId: string;
  /** The engine account id (the remote connected-account id): what an agent's pin names. */
  accountId: string;
  /** The source-namespaced toolkit an agent is granted for this account. */
  toolkitId: string;
  applicationId: ApplicationId;
  applicationName: string;
  sourceId: string;
  sourceKind: SourceEntry['kind'];
  sourceLabel: string;
  sourceEnabled: boolean;
  /** The provider's own identity, verified when connected. */
  verifiedEmail: string | null;
  /** The user's name for it ("Work"). Supplements the verified identity, never replaces it. */
  label: string | null;
  status: 'active' | 'needs_reauth';
  /** Calendars only: whether Ri's Calendar view and deck read it. */
  calendarUse: boolean | null;
  connectedAt: string;
}

export async function managedAccounts(): Promise<ManagedAccountView[]> {
  const { sourceServiceDeps } = await import('./service');
  const deps = await sourceServiceDeps();
  const preferences = currentPreferences();
  const connections = await listManagedConnections(deps.connectionStore(), { ownerId: deps.ownerId() });
  return connections.flatMap(connection => {
    const config = managedConfig(connection);
    if (!config) return [];
    const source = preferences.sources.find(candidate => candidate.id === config.sourceId);
    return [{
      connectionId: connection.id,
      accountId: connection.accountId,
      toolkitId: connection.providerId,
      applicationId: config.applicationId,
      applicationName: APPLICATIONS[config.applicationId].displayName,
      sourceId: config.sourceId,
      sourceKind: config.sourceKind,
      sourceLabel: source?.label ?? 'Removed source',
      sourceEnabled: source?.enabled ?? false,
      verifiedEmail: config.verifiedEmail ?? null,
      label: connection.label && connection.label !== config.verifiedEmail ? connection.label : null,
      status: connection.status,
      calendarUse: config.applicationId === 'google_calendar' ? preferences.calendarUse[connection.id] === true : null,
      connectedAt: connection.createdAt,
    }];
  }).sort((a, b) => a.applicationName.localeCompare(b.applicationName) || a.connectedAt.localeCompare(b.connectedAt));
}
