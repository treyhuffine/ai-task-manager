export type ExternalAgentSource = 'claude' | 'codex';

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

export interface ExternalAgentImportFailure {
  key: string;
  error: string;
}

export interface ExternalAgentImportResult {
  importedSessions: number;
  importedEvents: number;
  createdWorkspaces: number;
  skippedSessions: number;
  failures: ExternalAgentImportFailure[];
}
