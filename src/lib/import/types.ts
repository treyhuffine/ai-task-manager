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
}

export interface ExternalAgentProjectCandidate {
  id: string;
  name: string;
  cwd: string;
  pathExists: boolean;
  sessions: ExternalAgentSessionCandidate[];
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
}

export interface ExternalAgentImportRequest {
  sessionKeys: string[];
}

export interface ExternalAgentRefreshRequest {
  chatSessionIds: string[];
}

export interface ExternalAgentImportFailure {
  key: string;
  error: string;
}

/** Which Flow chat a requested key ended up as, imported or already present. */
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
