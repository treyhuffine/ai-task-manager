/**
 * The applications a managed source can connect, and how each maps to its direct route and to
 * each source kind's remote toolkit. One table, so the catalog, method selection, the access
 * picker and connection requests all agree on what "Gmail" means.
 */
import type { ApplicationId, Capability, SourceKind } from './types';

export interface ApplicationDefinition {
  id: ApplicationId;
  displayName: string;
  /** The direct connector that covers this application, and its toolkit there. */
  direct: { providerId: string; toolkitId: string };
  /** The remote toolkit per source kind. A kind that lacks the application is absent. */
  remoteToolkits: Partial<Record<SourceKind, string>>;
  /** What a managed connection supports for this application in this release. */
  managedCapabilities: Capability[];
}

export const APPLICATIONS: Record<ApplicationId, ApplicationDefinition> = {
  gmail: {
    id: 'gmail',
    displayName: 'Gmail',
    direct: { providerId: 'google', toolkitId: 'gmail' },
    remoteToolkits: { composio: 'gmail' },
    managedCapabilities: ['agent_tools'],
  },
  google_calendar: {
    id: 'google_calendar',
    displayName: 'Google Calendar',
    direct: { providerId: 'google', toolkitId: 'google_calendar' },
    remoteToolkits: { composio: 'googlecalendar' },
    managedCapabilities: ['agent_tools', 'calendar_view'],
  },
};

export function isApplicationId(value: unknown): value is ApplicationId {
  return typeof value === 'string' && Object.hasOwn(APPLICATIONS, value);
}

/** The application a direct toolkit belongs to, if a managed source can also connect it. */
export function applicationForDirectToolkit(toolkitId: string): ApplicationId | undefined {
  return (Object.values(APPLICATIONS).find(app => app.direct.toolkitId === toolkitId))?.id;
}

/**
 * The engine provider (and toolkit) id of one application through one source instance. It is
 * namespaced by the source, so a managed account never enters a grant written for the direct
 * toolkit, and two source instances never share accounts. Short on purpose: it prefixes every
 * tool name the model sees, and harnesses cap tool names near 64 characters.
 */
export function managedToolkitId(sourceId: string, applicationId: ApplicationId): string {
  return `${sourceId}_${applicationId}`;
}

/** Parse a managed toolkit id back to its source and application. */
export function parseManagedToolkitId(toolkitId: string): { sourceId: string; applicationId: ApplicationId } | null {
  for (const applicationId of Object.keys(APPLICATIONS) as ApplicationId[]) {
    const suffix = `_${applicationId}`;
    if (toolkitId.endsWith(suffix) && toolkitId.length > suffix.length) {
      const sourceId = toolkitId.slice(0, -suffix.length);
      if (SOURCE_ID_PATTERN.test(sourceId)) return { sourceId, applicationId };
    }
  }
  return null;
}

/** Source ids are `<kind prefix><4 lowercase base32>`, e.g. `cmpk3f9`. */
export const SOURCE_ID_PATTERN = /^cmp[a-z2-7]{4}$/;
