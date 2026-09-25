export type ExternalAgentSource = 'claude' | 'codex' | 'opencode';

export type ExternalAgentImportStatus =
  | 'not_imported'
  | 'importing'
  | 'current'
  | 'changed'
  | 'missing'
  | 'error';

export interface ExternalAgentSessionCandidate {
  /** Stable selection key. The server resolves it against trusted local roots. */
  key: string;
  source: ExternalAgentSource;
  externalSessionId: string;
  label: string;
  cwd: string;
  startedAt: string;
  updatedAt: string;
  branchName: string | null;
  imported: boolean;
  importStatus: ExternalAgentImportStatus;
  /** Present after import. Used by the explicit refresh endpoint. */
  chatSessionId?: string;
  /**
   * From a connected computer (P2.9): whether it can be imported, and when
   * it can't, why and what to do.
   */
  importable?: boolean;
  note?: string;
}

export interface ExternalAgentProjectCandidate {
  id: string;
  name: string;
  cwd: string;
  pathExists: boolean;
  sessions: ExternalAgentSessionCandidate[];
  /** From a connected computer: the agent set up in this folder there, which its sessions import into. */
  agent?: { id: string; name: string } | null;
}

export interface ExternalAgentSourceSummary {
  available: boolean;
  found: number;
  imported: number;
}

export interface ExternalAgentDiscovery {
  projects: ExternalAgentProjectCandidate[];
  sources: Record<ExternalAgentSource, ExternalAgentSourceSummary>;
  scannedAt: string;
  /** The connected computer listed, when it isn't the home's own (P2.9). */
  computer?: { id: string; name: string };
}

export interface ExternalAgentImportRequest {
  sessionKeys: string[];
  /** Import from this connected computer. Absent: the home's own. */
  computerId?: string | null;
}

export interface ExternalAgentRefreshRequest {
  chatSessionIds: string[];
}

export interface ExternalAgentImportFailure {
  key: string;
  error: string;
}

/** Which Ri chat a requested key ended up as, imported or already present. */
export interface ExternalAgentImportedSession {
  key: string;
  chatSessionId: string;
}

export interface ExternalAgentImportResult {
  importedSessions: number;
  importedEvents: number;
  syncedSessions: number;
  syncedEvents: number;
  createdWorkspaces: number;
  skippedSessions: number;
  failures: ExternalAgentImportFailure[];
  /**
   * Key → chat mapping for everything that landed. The bulk settings panel
   * ignores this and renders counts, but the launcher's single-session
   * adopt path needs the id so it can navigate into the chat it just
   * pulled in without re-running a full provider scan.
   */
  sessions: ExternalAgentImportedSession[];
}
