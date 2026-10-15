/**
 * Managed connection sources (docs/connector-service-spec.md). A source is a service that holds
 * connected accounts' credentials for Ri, such as the user's own Composio project. Direct
 * connections (Ri's native and MCP connectors) are not sources and need no entry here.
 *
 * These are the shapes of `<config-dir>/integrations/preferences.json` (safe metadata and
 * preferences only, never a secret) and the vocabulary shared by the server and the UI.
 */

/** Source kinds Ri can talk to. Composio is the first, the owner's own service comes later. */
export const SOURCE_KINDS = ['composio'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * Applications a managed source can connect in this release. The id equals the native toolkit id
 * of the same application, so a direct Gmail and a managed Gmail group under one heading.
 */
export const APPLICATION_IDS = ['gmail', 'google_calendar'] as const;
export type ApplicationId = (typeof APPLICATION_IDS)[number];

/** What a connection can be used for. A method is offered only where it supports the need. */
export type Capability = 'agent_tools' | 'calendar_view';

export interface SourceEntry {
  /** Generated, opaque and immutable. Never reused after removal. */
  id: string;
  kind: SourceKind;
  label: string;
  enabled: boolean;
  /** The stable external user this home's accounts belong to in the source. Generated, immutable. */
  remoteUserId: string;
  createdAt: string;
  /** The verified project the key reaches, when the source exposes one. */
  project?: { id: string; name?: string };
  /** The source's auth config per remote toolkit, created by Ri (Composio-managed auth). */
  authConfigs?: Record<string, string>;
}

/** Create new connections through a managed source. */
export interface ManagedMethod {
  sourceId: string;
}

/** Create new connections through a direct connector, optionally with a specific OAuth app. */
export interface DirectMethod {
  kind: 'direct';
  providerId: string;
  authConfigId?: string;
}

export type ApplicationMethod = ManagedMethod | DirectMethod;

export function isManagedMethod(method: ApplicationMethod): method is ManagedMethod {
  return 'sourceId' in method;
}

export interface SourcePreferences {
  version: 1;
  sources: SourceEntry[];
  /** The overall preference for new connections. Unset means no managed preference. */
  preferredSourceId?: string;
  /** Explicit per-application overrides, set only by "Change method". */
  applicationMethods: Partial<Record<ApplicationId, ApplicationMethod>>;
  /** Removed source ids, kept so a new source never takes an old id. */
  retiredSourceIds: string[];
  /**
   * Managed calendar connections the user lets Ri's Calendar view and deck read, by connection id.
   * Independent of agent access. Absent means not read.
   */
  calendarUse: Record<string, boolean>;
}

export const EMPTY_PREFERENCES: SourcePreferences = {
  version: 1, sources: [], applicationMethods: {}, retiredSourceIds: [], calendarUse: {},
};
