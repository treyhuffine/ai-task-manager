import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLAUDE_ID = '11111111-1111-4111-8111-111111111111';
// Provider-owned ids can collide. The ledger must qualify identity by source.
const CODEX_ID = CLAUDE_ID;

describe('external agent imports', () => {
  let root: string;
  let claudeHome: string;
  let codexHome: string;
  let projectOne: string;
  let projectTwo: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-agent-import-'));
    claudeHome = path.join(root, 'claude');
    codexHome = path.join(root, 'codex');
    projectOne = path.join(root, 'project-one');
    projectTwo = path.join(root, 'project-two');
    fs.mkdirSync(projectOne, { recursive: true });
    fs.mkdirSync(projectTwo, { recursive: true });
    fs.mkdirSync(path.join(claudeHome, 'projects', '-project-one'), { recursive: true });
    fs.mkdirSync(path.join(codexHome, 'sessions', '2026', '01', '02'), { recursive: true });

    const env = {
      CLAUDE_CONFIG_DIR: claudeHome,
      CODEX_HOME: codexHome,
      FLOW_ROOT: path.join(root, 'flow-root'),
      FLOW_DB_PATH: path.join(root, 'flow.db'),
      FLOW_MIRROR_DISABLED: '1',
    };
    for (const [key, value] of Object.entries(env)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }

    writeJsonl(path.join(claudeHome, 'projects', '-project-one', `${CLAUDE_ID}.jsonl`), [
      {
        type: 'user',
        uuid: 'claude-user-1',
        sessionId: CLAUDE_ID,
        cwd: projectOne,
        gitBranch: 'feature/claude',
        timestamp: '2026-01-01T10:00:00.000Z',
        isSidechain: false,
        message: { role: 'user', content: 'Build the import screen' },
      },
      { type: 'ai-title', sessionId: CLAUDE_ID, aiTitle: 'Import screen work' },
      {
        type: 'assistant',
        uuid: 'claude-assistant-1',
        sessionId: CLAUDE_ID,
        cwd: projectOne,
        timestamp: '2026-01-01T10:00:01.000Z',
        message: {
          id: 'msg_claude_1',
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will inspect the app.' },
            { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'package.json' } },
          ],
        },
      },
      {
        type: 'user',
        uuid: 'claude-tool-result-1',
        sessionId: CLAUDE_ID,
        cwd: projectOne,
        timestamp: '2026-01-01T10:00:02.000Z',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: '{}' }],
        },
      },
      {
        type: 'assistant',
        uuid: 'claude-assistant-2',
        sessionId: CLAUDE_ID,
        cwd: projectOne,
        timestamp: '2026-01-01T10:00:03.000Z',
        message: {
          id: 'msg_claude_2',
          role: 'assistant',
          content: [{ type: 'text', text: 'The screen is ready.' }],
        },
      },
    ]);

    writeJsonl(
      path.join(codexHome, 'sessions', '2026', '01', '02', `rollout-2026-01-02T11-00-00-${CODEX_ID}.jsonl`),
      [
        {
          timestamp: '2026-01-02T11:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: CODEX_ID,
            cwd: projectTwo,
            timestamp: '2026-01-02T11:00:00.000Z',
            git: { branch: 'feature/codex' },
          },
        },
        {
          timestamp: '2026-01-02T11:00:00.500Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: '<environment_context><cwd>ignored</cwd></environment_context>' }],
          },
        },
        {
          timestamp: '2026-01-02T11:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'Add Codex import support' },
        },
        {
          timestamp: '2026-01-02T11:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Codex import is ready.' }],
          },
        },
      ],
    );
    writeJsonl(path.join(codexHome, 'session_index.jsonl'), [
      { id: CODEX_ID, thread_name: 'Codex import work', updated_at: '2026-01-02T11:00:02.000Z' },
    ]);
    vi.resetModules();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const dbModule = await import('@/lib/db');
    dbModule.resetDb();
    for (const key of Object.keys(savedEnv)) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    fs.rmSync(root, { recursive: true, force: true });
    vi.resetModules();
  });

  it('discovers both stores and imports each transcript exactly once', async () => {
    const importer = await import('./external-agents');
    const firstScan = await importer.discoverExternalAgentSessions();

    expect(firstScan.sources.claude).toMatchObject({ available: true, found: 1, imported: 0 });
    expect(firstScan.sources.codex).toMatchObject({ available: true, found: 1, imported: 0 });
    expect(firstScan.projects).toHaveLength(2);
    const candidates = firstScan.projects.flatMap((project) => project.sessions);
    expect(candidates.find((candidate) => candidate.source === 'claude')?.label).toBe('Import screen work');
    expect(candidates.find((candidate) => candidate.source === 'codex')?.label).toBe('Codex import work');

    const result = await importer.importExternalAgentSessions(candidates.map((candidate) => candidate.key));
    expect(result).toMatchObject({
      importedSessions: 2,
      importedEvents: 7,
      createdWorkspaces: 2,
      skippedSessions: 0,
      failures: [],
    });

    const q = await import('@/lib/db/queries');
    const sessions = q.listChatSessions({ type: 'execution' });
    expect(sessions).toHaveLength(2);
    // Active, not archived. An import you can't see in the workspace tree is
    // an import you can only reach by guessing a search term.
    expect(sessions.every((session) => session.status === 'active')).toBe(true);
    expect(sessions.every((session) => session.archivedAt === null)).toBe(true);
    expect(sessions.every((session) => session.surfaceKind === 'imported_agent')).toBe(true);
    // And the execution the chat hangs off has to agree — the workspace tree
    // reads the execution's status, the chat lists read the session's, so a
    // half-archived pair is invisible in exactly one of the two places.
    const executionRows = sessions.map((session) => q.getExecution(session.executionId!));
    expect(executionRows.every((row) => row?.status === 'active')).toBe(true);
    expect(executionRows.every((row) => row?.archivedAt === null)).toBe(true);

    const claudeSession = sessions.find((session) => session.surfaceRef === 'claude')!;
    expect(claudeSession.externalSessionId).toBeNull();
    expect(claudeSession.externalProviderType).toBeNull();
    const claudeEvents = q.listChatEvents(claudeSession.id, { limit: 50 });
    expect(claudeEvents.map((event) => event.source)).toEqual([
      'user',
      'agent',
      'tool_call',
      'tool_result',
      'agent',
    ]);
    expect(claudeEvents[0]?.content).toBe('Build the import screen');

    const codexSession = sessions.find((session) => session.surfaceRef === 'codex')!;
    expect(q.listChatEvents(codexSession.id, { limit: 50 }).map((event) => event.source)).toEqual(['user', 'agent']);

    const second = await importer.importExternalAgentSessions(candidates.map((candidate) => candidate.key));
    expect(second).toMatchObject({
      importedSessions: 0,
      syncedSessions: 2,
      syncedEvents: 0,
      skippedSessions: 0,
      failures: [],
    });
    expect(q.listChatSessions({ type: 'execution' })).toHaveLength(2);

    fs.appendFileSync(path.join(claudeHome, 'projects', '-project-one', `${CLAUDE_ID}.jsonl`), `${JSON.stringify({
      type: 'assistant',
      uuid: 'claude-assistant-3',
      sessionId: CLAUDE_ID,
      cwd: projectOne,
      timestamp: '2026-01-01T10:00:04.000Z',
      message: {
        id: 'msg_claude_3',
        role: 'assistant',
        content: [{ type: 'text', text: 'Synced after the initial import.' }],
      },
    })}\n`);
    const sync = await importer.importExternalAgentSessions([
      candidates.find((candidate) => candidate.source === 'claude')!.key,
    ]);
    expect(sync).toMatchObject({ syncedSessions: 1, syncedEvents: 1, failures: [] });
    expect(q.listChatEvents(claudeSession.id, { limit: 50 }).at(-1)?.content)
      .toBe('Synced after the initial import.');

    const claudeTranscriptPath = path.join(
      claudeHome,
      'projects',
      '-project-one',
      `${CLAUDE_ID}.jsonl`,
    );
    fs.appendFileSync(claudeTranscriptPath, `${JSON.stringify({
      type: 'ai-title',
      sessionId: CLAUDE_ID,
      aiTitle: 'Filtered bookkeeping tail',
    })}\n`);
    const filteredTailSync = await importer.importExternalAgentSessions([
      candidates.find((candidate) => candidate.source === 'claude')!.key,
    ]);
    expect(filteredTailSync).toMatchObject({ syncedSessions: 1, syncedEvents: 0, failures: [] });
    expect(q.getExternalSessionImportBySource('claude', CLAUDE_ID)?.syncOffset)
      .toBe(fs.statSync(claudeTranscriptPath).size);

    const secondScan = await importer.discoverExternalAgentSessions();
    expect(secondScan.sources.claude.imported).toBe(1);
    expect(secondScan.sources.codex.imported).toBe(1);
    expect(secondScan.sources.opencode).toMatchObject({ available: false, found: 0, imported: 0 });
  }, 15_000);

  it('replays a same-or-larger rewrite when the imported prefix changed', async () => {
    const importer = await import('./external-agents');
    const scan = await importer.discoverExternalAgentSessions();
    const claude = scan.projects.flatMap((project) => project.sessions)
      .find((candidate) => candidate.source === 'claude')!;
    await importer.importExternalAgentSessions([claude.key]);

    const q = await import('@/lib/db/queries');
    const session = q.listChatSessions({ type: 'execution' })
      .find((candidate) => candidate.surfaceRef === 'claude')!;
    q.insertChatEvent({
      sessionId: session.id,
      role: 'user',
      source: 'user',
      content: 'Flow-only note',
    });

    const transcriptPath = path.join(claudeHome, 'projects', '-project-one', `${CLAUDE_ID}.jsonl`);
    const records = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const first = records[0] as { message: { content: string } };
    first.message.content = 'Rewritten source prompt';
    records.push({
      type: 'assistant',
      uuid: 'claude-rewrite-assistant',
      sessionId: CLAUDE_ID,
      cwd: projectOne,
      timestamp: '2026-01-01T10:00:05.000Z',
      message: {
        id: 'msg_claude_rewrite',
        role: 'assistant',
        content: [{ type: 'text', text: 'Replacement transcript complete.' }],
      },
    });
    writeJsonl(transcriptPath, records);

    const result = await importer.importExternalAgentSessions([claude.key]);
    expect(result).toMatchObject({ syncedSessions: 1, syncedEvents: 6, failures: [] });
    const contents = q.listChatEvents(session.id, { limit: 50 }).map((event) => event.content);
    expect(contents).toContain('Rewritten source prompt');
    expect(contents).not.toContain('Build the import screen');
    expect(contents).toContain('Replacement transcript complete.');
    expect(contents).toContain('Flow-only note');
  });

  it('does not commit staged file events when the source changes during the read', async () => {
    const importer = await import('./external-agents');
    const scan = await importer.discoverExternalAgentSessions();
    const claude = scan.projects.flatMap((project) => project.sessions)
      .find((candidate) => candidate.source === 'claude')!;
    await importer.importExternalAgentSessions([claude.key]);

    const q = await import('@/lib/db/queries');
    const session = q.listChatSessions({ type: 'execution' })
      .find((candidate) => candidate.surfaceRef === 'claude')!;
    const beforeContents = q.listChatEvents(session.id, { limit: 50 }).map((event) => event.content);
    fs.appendFileSync(path.join(claudeHome, 'projects', '-project-one', `${CLAUDE_ID}.jsonl`), `${JSON.stringify({
      type: 'assistant',
      uuid: 'claude-unstable-assistant',
      sessionId: CLAUDE_ID,
      cwd: projectOne,
      timestamp: '2026-01-01T10:00:06.000Z',
      message: {
        id: 'msg_claude_unstable',
        role: 'assistant',
        content: [{ type: 'text', text: 'Must not commit yet.' }],
      },
    })}\n`);

    const agentex = await import('@agentex/agent');
    const history = agentex.getProvider('claude').localHistory!;
    const fingerprint = history.fingerprint.bind(history);
    let calls = 0;
    vi.spyOn(history, 'fingerprint').mockImplementation(async (...args) => {
      const value = await fingerprint(...args);
      calls++;
      return calls === 2
        ? { ...value, modifiedAtNs: `${BigInt(value.modifiedAtNs) + BigInt(1)}` }
        : value;
    });

    const result = await importer.importExternalAgentSessions([claude.key]);
    expect(result.syncedSessions).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(q.listChatEvents(session.id, { limit: 50 }).map((event) => event.content))
      .toEqual(beforeContents);
    expect(q.getExternalSessionImportBySource('claude', CLAUDE_ID)?.status).toBe('error');
  });

  it('fully verifies a legacy file checkpoint that has no prefix hash', async () => {
    const importer = await import('./external-agents');
    const scan = await importer.discoverExternalAgentSessions();
    const claude = scan.projects.flatMap((project) => project.sessions)
      .find((candidate) => candidate.source === 'claude')!;
    await importer.importExternalAgentSessions([claude.key]);

    const q = await import('@/lib/db/queries');
    const ledger = q.getExternalSessionImportBySource('claude', CLAUDE_ID)!;
    q.updateExternalSessionImport(ledger.id, { sourceContentSha256: null });

    const result = await importer.importExternalAgentSessions([claude.key]);
    expect(result).toMatchObject({ syncedSessions: 1, syncedEvents: 5, failures: [] });
    expect(q.getExternalSessionImportBySource('claude', CLAUDE_ID)?.sourceContentSha256)
      .toMatch(/^[0-9a-f]{64}$/);
  });

  it('cleans up a new workspace and skeleton when the first read fails', async () => {
    const agentex = await import('@agentex/agent');
    const history = agentex.getProvider('claude').localHistory!;
    vi.spyOn(history, 'read').mockImplementation(async function* () {
      throw new Error('broken transcript');
    });

    const importer = await import('./external-agents');
    const scan = await importer.discoverExternalAgentSessions();
    const claude = scan.projects.flatMap((project) => project.sessions)
      .find((candidate) => candidate.source === 'claude')!;
    const result = await importer.importExternalAgentSessions([claude.key]);
    expect(result).toMatchObject({ importedSessions: 0, createdWorkspaces: 0 });
    expect(result.failures).toHaveLength(1);

    const q = await import('@/lib/db/queries');
    expect(q.listChatSessions({ type: 'execution' })).toHaveLength(0);
    expect(q.listExternalSessionImports()).toHaveLength(0);
    expect(q.listWorkspaces({ status: 'active' })).toHaveLength(0);
    expect(q.listWorkspaces({ status: 'archived' })).toHaveLength(0);
  });
});

function writeJsonl(filePath: string, records: Record<string, unknown>[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
}
