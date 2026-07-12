import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLAUDE_ID = '11111111-1111-4111-8111-111111111111';
const CODEX_ID = '22222222-2222-4222-8222-222222222222';

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
    expect(sessions.every((session) => session.status === 'archived')).toBe(true);
    expect(sessions.every((session) => session.surfaceKind === 'imported_agent')).toBe(true);

    const claudeSession = sessions.find((session) => session.externalSessionId === CLAUDE_ID)!;
    const claudeEvents = q.listChatEvents(claudeSession.id, { limit: 50 });
    expect(claudeEvents.map((event) => event.source)).toEqual([
      'user',
      'agent',
      'tool_call',
      'tool_result',
      'agent',
    ]);
    expect(claudeEvents[0]?.content).toBe('Build the import screen');

    const codexSession = sessions.find((session) => session.externalSessionId === CODEX_ID)!;
    expect(q.listChatEvents(codexSession.id, { limit: 50 }).map((event) => event.source)).toEqual(['user', 'agent']);

    const second = await importer.importExternalAgentSessions(candidates.map((candidate) => candidate.key));
    expect(second).toMatchObject({ importedSessions: 0, skippedSessions: 2, failures: [] });
    expect(q.listChatSessions({ type: 'execution' })).toHaveLength(2);

    const secondScan = await importer.discoverExternalAgentSessions();
    expect(secondScan.sources.claude.imported).toBe(1);
    expect(secondScan.sources.codex.imported).toBe(1);
  });
});

function writeJsonl(filePath: string, records: Record<string, unknown>[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
}
