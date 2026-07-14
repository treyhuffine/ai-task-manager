import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const savedState = vi.hoisted(() => ({
  mode: 'initial' as 'initial' | 'noop' | 'failed_resync' | 'concurrent',
  updatedAt: '2026-02-01T10:00:02.000Z',
  calls: [] as Array<{ after: unknown; mode: string | undefined; cwd: string | undefined }>,
  concurrentReads: 0,
  activeReads: 0,
  maxActiveReads: 0,
}));

vi.mock('@agentex/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentex/agent')>();
  return {
    ...actual,
    getProvider(providerType: Parameters<typeof actual.getProvider>[0]) {
      const provider = actual.getProvider(providerType);
      if (providerType !== 'opencode') return provider;
      return {
        ...provider,
        capabilities: { ...provider.capabilities, savedHistory: true },
        savedHistory: {
          async probe() {
            return {
              providerType: 'opencode',
              sourceAvailable: true,
              historyAvailable: true,
              approximateCount: 1,
            };
          },
          async *discover() {
            yield {
              version: 1,
              providerType: 'opencode',
              externalSessionId: 'ses_opencode_import',
              cwd: process.env.TEST_OPENCODE_PROJECT!,
              title: 'OpenCode saved chat',
              startedAt: '2026-02-01T10:00:00.000Z',
              updatedAt: savedState.updatedAt,
              branch: 'feature/opencode',
              gitOriginUrl: null,
              archiveState: 'active',
              hasUserMessage: true,
            };
          },
          async *read(_session: unknown, options: {
            after?: unknown;
            mode?: string;
            cwd?: string;
          } = {}) {
            savedState.calls.push({
              after: options.after,
              mode: options.mode,
              cwd: options.cwd,
            });
            if (savedState.mode === 'noop') return;
            if (savedState.mode === 'concurrent') {
              const readNumber = ++savedState.concurrentReads;
              savedState.activeReads++;
              savedState.maxActiveReads = Math.max(
                savedState.maxActiveReads,
                savedState.activeReads,
              );
              try {
                if (readNumber === 1) {
                  await new Promise((resolve) => setTimeout(resolve, 40));
                }
                const eventId = `concurrent-${readNumber}`;
                yield {
                  event: {
                    type: 'assistant',
                    text: `Concurrent update ${readNumber}`,
                    timestamp: `2026-02-01T12:00:0${readNumber}.000Z`,
                    providerType: 'opencode',
                  },
                  checkpoint: { kind: 'opencode:test', value: { id: eventId } },
                  eventId,
                  partIndex: 0,
                };
              } finally {
                savedState.activeReads--;
              }
              return;
            }
            if (savedState.mode === 'failed_resync' && options.after) {
              throw Object.assign(new Error('checkpoint disappeared'), {
                code: 'history_checkpoint_not_found',
              });
            }
            if (savedState.mode === 'failed_resync') {
              yield {
                event: {
                  type: 'assistant',
                  text: 'Incomplete replacement',
                  timestamp: '2026-02-01T11:00:00.000Z',
                  providerType: 'opencode',
                },
                checkpoint: { kind: 'opencode:test', value: { id: 'replacement-1' } },
                eventId: 'replacement-1',
                partIndex: 0,
              };
              throw Object.assign(new Error('bounded full resync failed'), {
                code: 'history_resync_limit',
              });
            }
            yield {
              event: {
                type: 'user',
                text: 'Import my OpenCode chat',
                timestamp: '2026-02-01T10:00:00.000Z',
                providerType: 'opencode',
              },
              checkpoint: { kind: 'opencode:test', value: { id: 'initial-1' } },
              eventId: 'initial-1',
              partIndex: 0,
            };
            yield {
              event: {
                type: 'assistant',
                text: 'OpenCode history imported',
                timestamp: '2026-02-01T10:00:02.000Z',
                providerType: 'opencode',
              },
              checkpoint: { kind: 'opencode:test', value: { id: 'initial-2' } },
              eventId: 'initial-2',
              partIndex: 0,
            };
          },
        },
      };
    },
  };
});

describe('OpenCode saved history imports', () => {
  let root: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-opencode-import-'));
    const project = path.join(root, 'project');
    fs.mkdirSync(project, { recursive: true });
    const env = {
      TEST_OPENCODE_PROJECT: project,
      CLAUDE_CONFIG_DIR: path.join(root, 'claude'),
      CODEX_HOME: path.join(root, 'codex'),
      FLOW_ROOT: path.join(root, 'flow-root'),
      FLOW_DB_PATH: path.join(root, 'flow.db'),
      FLOW_MIRROR_DISABLED: '1',
    };
    for (const [key, value] of Object.entries(env)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
    savedState.mode = 'initial';
    savedState.updatedAt = '2026-02-01T10:00:02.000Z';
    savedState.calls = [];
    savedState.concurrentReads = 0;
    savedState.activeReads = 0;
    savedState.maxActiveReads = 0;
    vi.resetModules();
  });

  afterEach(async () => {
    const dbModule = await import('@/lib/db');
    dbModule.resetDb();
    for (const key of Object.keys(savedEnv)) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    fs.rmSync(root, { recursive: true, force: true });
    vi.resetModules();
  });

  it('preserves checkpoints on no-op sync and keeps the old transcript when full resync fails', async () => {
    const importer = await import('./external-agents');
    const scan = await importer.discoverExternalAgentSessions();
    const candidate = scan.projects.flatMap((project) => project.sessions)
      .find((session) => session.source === 'opencode')!;
    expect(candidate.externalSessionId).toBe('ses_opencode_import');

    const imported = await importer.importExternalAgentSessions([candidate.key]);
    expect(imported).toMatchObject({ importedSessions: 1, importedEvents: 2, failures: [] });
    const q = await import('@/lib/db/queries');
    const session = q.listChatSessions({ type: 'execution' })
      .find((row) => row.surfaceRef === 'opencode')!;
    const originalContents = q.listChatEvents(session.id, { limit: 50 }).map((event) => event.content);
    const originalCheckpoint = q.getExternalSessionImportBySource(
      'opencode',
      'ses_opencode_import',
    )!.historyCheckpoint;
    expect(originalCheckpoint).toEqual({ kind: 'opencode:test', value: { id: 'initial-2' } });
    expect(savedState.calls[0]?.cwd).toBe(process.env.FLOW_ROOT);

    savedState.mode = 'noop';
    const noOp = await importer.importExternalAgentSessions([candidate.key]);
    expect(noOp).toMatchObject({ syncedSessions: 1, syncedEvents: 0, failures: [] });
    expect(q.getExternalSessionImportBySource(
      'opencode',
      'ses_opencode_import',
    )!.historyCheckpoint).toEqual(originalCheckpoint);

    savedState.mode = 'failed_resync';
    savedState.updatedAt = '2026-02-01T11:00:00.000Z';
    const failed = await importer.importExternalAgentSessions([candidate.key]);
    expect(failed.syncedSessions).toBe(0);
    expect(failed.failures).toHaveLength(1);
    expect(q.listChatEvents(session.id, { limit: 50 }).map((event) => event.content))
      .toEqual(originalContents);
    const ledger = q.getExternalSessionImportBySource('opencode', 'ses_opencode_import')!;
    expect(ledger.historyCheckpoint).toEqual(originalCheckpoint);
    expect(ledger.status).toBe('error');
  });

  it('serializes concurrent syncs so a stale checkpoint cannot overwrite a newer one', async () => {
    const importer = await import('./external-agents');
    const scan = await importer.discoverExternalAgentSessions();
    const candidate = scan.projects.flatMap((project) => project.sessions)
      .find((session) => session.source === 'opencode')!;
    await importer.importExternalAgentSessions([candidate.key]);

    savedState.mode = 'concurrent';
    savedState.updatedAt = '2026-02-01T12:00:02.000Z';
    const [first, second] = await Promise.all([
      importer.importExternalAgentSessions([candidate.key]),
      importer.importExternalAgentSessions([candidate.key]),
    ]);
    expect(first).toMatchObject({ syncedSessions: 1, syncedEvents: 1, failures: [] });
    expect(second).toMatchObject({ syncedSessions: 1, syncedEvents: 1, failures: [] });
    expect(savedState.maxActiveReads).toBe(1);

    const q = await import('@/lib/db/queries');
    const ledger = q.getExternalSessionImportBySource('opencode', 'ses_opencode_import')!;
    expect(ledger.historyCheckpoint).toEqual({
      kind: 'opencode:test',
      value: { id: 'concurrent-2' },
    });
    const incrementalCalls = savedState.calls.slice(-2);
    expect(incrementalCalls[0]?.after).toEqual({
      kind: 'opencode:test',
      value: { id: 'initial-2' },
    });
    expect(incrementalCalls[1]?.after).toEqual({
      kind: 'opencode:test',
      value: { id: 'concurrent-1' },
    });
  });
});
