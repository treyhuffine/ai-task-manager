import { describe, expect, it } from 'vitest';
import {
  formatImportResultSummary,
  hasExternalAgentDiscoveryRows,
} from './imports-section';
import type {
  ExternalAgentDiscovery,
  ExternalAgentImportResult,
} from '@/lib/import/types';

function result(overrides: Partial<ExternalAgentImportResult> = {}): ExternalAgentImportResult {
  return {
    importedSessions: 0,
    importedEvents: 0,
    syncedSessions: 0,
    syncedEvents: 0,
    createdWorkspaces: 0,
    skippedSessions: 0,
    failures: [],
    ...overrides,
  };
}

describe('formatImportResultSummary', () => {
  it('describes mixed imports and transcript syncs', () => {
    expect(formatImportResultSummary(result({
      importedSessions: 2,
      importedEvents: 42,
      syncedSessions: 1,
      syncedEvents: 3,
      createdWorkspaces: 1,
    }))).toBe('Imported 2 chats and 42 events into 1 new project. Synced 1 chat with 3 new events.');
  });

  it('reports a successful sync with no new transcript events', () => {
    expect(formatImportResultSummary(result({
      syncedSessions: 1,
      syncedEvents: 0,
    }))).toBe('Synced 1 chat with 0 new events.');
  });

  it('includes skipped chats and failures when nothing changed', () => {
    expect(formatImportResultSummary(result({
      skippedSessions: 1,
      failures: [{ key: 'opencode:session-1', error: 'Unavailable' }],
    }))).toBe('No chats needed updating. 1 chat was skipped. 1 could not be updated.');
  });
});

describe('hasExternalAgentDiscoveryRows', () => {
  it('keeps imported chats visible when every local source is missing', () => {
    const discovery: ExternalAgentDiscovery = {
      scannedAt: '2026-07-14T12:00:00.000Z',
      sources: {
        claude: { available: false, found: 0, imported: 0 },
        codex: { available: false, found: 0, imported: 0 },
        opencode: { available: false, found: 0, imported: 1 },
      },
      projects: [{
        id: '/tmp/example',
        name: 'example',
        cwd: '/tmp/example',
        pathExists: false,
        sessions: [{
          key: 'opencode:c2Vzc2lvbi0x',
          source: 'opencode',
          externalSessionId: 'session-1',
          label: 'Missing OpenCode chat',
          cwd: '/tmp/example',
          startedAt: '2026-07-14T10:00:00.000Z',
          updatedAt: '2026-07-14T11:00:00.000Z',
          branchName: null,
          imported: true,
          importStatus: 'missing',
          chatSessionId: 'chat-1',
        }],
      }],
    };

    expect(hasExternalAgentDiscoveryRows(discovery)).toBe(true);
  });

  it('uses the empty state when discovery has no session rows', () => {
    const discovery: ExternalAgentDiscovery = {
      scannedAt: '2026-07-14T12:00:00.000Z',
      sources: {
        claude: { available: false, found: 0, imported: 0 },
        codex: { available: false, found: 0, imported: 0 },
        opencode: { available: false, found: 0, imported: 0 },
      },
      projects: [],
    };

    expect(hasExternalAgentDiscoveryRows(discovery)).toBe(false);
  });
});
