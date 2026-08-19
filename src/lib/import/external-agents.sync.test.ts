/**
 * Keeping an imported chat current with the terminal that's still writing it.
 *
 * The failure these cover: a chat imported from a Claude session the user is
 * still driving in their terminal stops updating in the app. The transcript
 * grows, the ledger notices ("Updates found"), and nothing pulls the delta,
 * because Resync and the session-open reconcile both routed through the
 * executor's transcript path — which bails immediately on an imported chat,
 * since imported chats have no `external_session_id`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CLAUDE_ID = '22222222-2222-4222-8222-222222222222';

const dispatch = vi.hoisted(() => vi.fn(async () => undefined));

// Only `dispatch` is faked. Everything else in the adapter (parseStreamEvent,
// the in-memory liveness maps) is the real thing, and on an empty process the
// real answers are the ones this test wants: no cached handle, nothing running.
vi.mock('@/lib/executor/adapter', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/executor/adapter')>(),
  dispatch,
}));

describe('imported chat sync', () => {
  // Every case here runs a real three-provider discovery scan (the import flow
  // is the thing under test, so stubbing it out would test nothing), and one
  // of those providers shells out to resolve a binary. That fits inside the
  // 5s default when the file runs alone and does not when the whole suite is
  // competing for CPU. Matches the 15s the sibling import test already uses.
  vi.setConfig({ testTimeout: 30_000 });

  let root: string;
  let claudeHome: string;
  let project: string;
  let transcriptPath: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-import-sync-'));
    claudeHome = path.join(root, 'claude');
    project = path.join(root, 'project');
    fs.mkdirSync(project, { recursive: true });
    // A real repo, because the bug being guarded here only exists on git
    // workspaces: that is the branch of `continueExecutionSession` that cuts a
    // worktree. On a plain directory it returns early and proves nothing.
    // No commit needed: `detectIsGit` and the worktree branch of
    // `continueExecutionSession` only care that this is a repo.
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project });
    transcriptPath = path.join(claudeHome, 'projects', '-project', `${CLAUDE_ID}.jsonl`);

    const env = {
      CLAUDE_CONFIG_DIR: claudeHome,
      CODEX_HOME: path.join(root, 'codex'),
      FLOW_ROOT: path.join(root, 'flow-root'),
      FLOW_DB_PATH: path.join(root, 'flow.db'),
      FLOW_MIRROR_DISABLED: '1',
    };
    for (const [key, value] of Object.entries(env)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }

    writeJsonl(transcriptPath, [
      userRecord('claude-user-1', '2026-03-01T10:00:00.000Z', 'Plan the export'),
      assistantRecord('claude-assistant-1', '2026-03-01T10:00:01.000Z', 'Here is the plan.'),
    ]);
    dispatch.mockClear();
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

  /** Import the fixture transcript and return the chat it produced. */
  async function importFixture(): Promise<string> {
    const importer = await import('./external-agents');
    const scan = await importer.discoverExternalAgentSessions();
    const candidate = scan.projects
      .flatMap((entry) => entry.sessions)
      .find((session) => session.externalSessionId === CLAUDE_ID)!;
    const result = await importer.importExternalAgentSessions([candidate.key]);
    expect(result.failures).toEqual([]);
    return result.sessions[0]!.chatSessionId;
  }

  it('pulls transcript lines the terminal appended after the import', async () => {
    const chatSessionId = await importFixture();
    const q = await import('@/lib/db/queries');
    expect(q.listChatEvents(chatSessionId, { limit: 50 })).toHaveLength(2);

    appendRecords([
      userRecord('claude-user-2', '2026-03-01T10:05:00.000Z', 'Postgis or plain lat/lng?'),
      assistantRecord('claude-assistant-2', '2026-03-01T10:05:30.000Z', 'Plain lat/lng for now.'),
    ]);

    const importer = await import('./external-agents');
    expect(await importer.syncImportedSession(chatSessionId)).toEqual({ replayed: 2 });

    const contents = q.listChatEvents(chatSessionId, { limit: 50 }).map((event) => event.content);
    expect(contents).toEqual([
      'Plan the export',
      'Here is the plan.',
      'Postgis or plain lat/lng?',
      'Plain lat/lng for now.',
    ]);

    // A second call has nothing to do, and says so rather than replaying.
    expect(await importer.syncImportedSession(chatSessionId))
      .toEqual({ replayed: 0, skipped: 'current' });
    expect(q.listChatEvents(chatSessionId, { limit: 50 })).toHaveLength(4);
  });

  it('reports a chat that was never imported so the caller can fall through', async () => {
    const importer = await import('./external-agents');
    expect(await importer.syncImportedSession('not-an-imported-chat'))
      .toEqual({ replayed: 0, skipped: 'not_imported' });
  });

  it('marks the ledger missing once the provider transcript is gone', async () => {
    const chatSessionId = await importFixture();
    fs.rmSync(transcriptPath);

    const importer = await import('./external-agents');
    expect(await importer.syncImportedSession(chatSessionId))
      .toEqual({ replayed: 0, skipped: 'source_missing' });

    const q = await import('@/lib/db/queries');
    expect(q.getExternalSessionImportForChat(chatSessionId)?.status).toBe('missing');
  });

  it('routes reconcile — and therefore Resync — to the import sync', async () => {
    const chatSessionId = await importFixture();
    appendRecords([
      assistantRecord('claude-assistant-2', '2026-03-01T10:06:00.000Z', 'Ran it in the terminal.'),
    ]);

    // The exact call Resync and session-open make. It used to return
    // `no_external_session` and leave the chat behind forever.
    const { reconcileSession } = await import('@/lib/executor/reconcile');
    expect(await reconcileSession(chatSessionId)).toEqual({ drift: true, replayed: 1 });

    const q = await import('@/lib/db/queries');
    expect(q.listChatEvents(chatSessionId, { limit: 50 }).at(-1)?.content)
      .toBe('Ran it in the terminal.');
  });

  it('stops preferring the imported transcript once the chat has a live session', async () => {
    const chatSessionId = await importFixture();
    appendRecords([
      assistantRecord('claude-assistant-2', '2026-03-01T10:06:30.000Z', 'Terminal kept going.'),
    ]);

    // What sending into an imported chat does: the adapter promotes a real
    // provider session onto the row. That transcript is the chat's history
    // from here on, so reconcile must stop merging the old imported one in.
    const q = await import('@/lib/db/queries');
    q.updateChatSession(chatSessionId, { externalSessionId: 'live-session-id' });

    const { reconcileSession } = await import('@/lib/executor/reconcile');
    const result = await reconcileSession(chatSessionId);
    expect(result.replayed).toBe(0);
    expect(result.skipped).not.toBe('import_current');

    expect(q.listChatEvents(chatSessionId, { limit: 50 })).toHaveLength(2);
    const importer = await import('./external-agents');
    expect(await importer.syncAllImportedSessions())
      .toEqual({ checked: 0, synced: 0, replayed: 0, errors: 0 });
  });

  it('sweeps every active imported chat on one discovery pass', async () => {
    const chatSessionId = await importFixture();
    appendRecords([
      assistantRecord('claude-assistant-2', '2026-03-01T10:07:00.000Z', 'Swept in at cold start.'),
    ]);

    const importer = await import('./external-agents');
    expect(await importer.syncAllImportedSessions())
      .toEqual({ checked: 1, synced: 1, replayed: 1, errors: 0 });

    const q = await import('@/lib/db/queries');
    expect(q.listChatEvents(chatSessionId, { limit: 50 }).at(-1)?.content)
      .toBe('Swept in at cold start.');
  });

  it('lands the execution in the project folder, never a worktree', async () => {
    const chatSessionId = await importFixture();
    const q = await import('@/lib/db/queries');
    const session = q.getChatSessionWithExecution(chatSessionId)!;

    // Live-mode shape: worktreePath === workspace cwd. A null here read as
    // "git workspace still provisioning", and the first send cut a worktree on
    // a new branch, which moved the cwd the provider derives its transcript
    // directory from and stranded the imported session.
    expect(session.worktreePath).toBe(project);
    expect(q.getWorkspace(session.workspaceId!)?.cwd).toBe(project);
    expect(session.branchName).toBe('main');
  });

  it('takes the chat over by resuming the imported session, in place', async () => {
    const chatSessionId = await importFixture();
    const importer = await import('./external-agents');
    const q = await import('@/lib/db/queries');

    expect(q.getChatSession(chatSessionId)?.externalSessionId).toBeNull();
    const result = importer.takeOverImportedSession(chatSessionId);
    expect(result).toEqual({ externalSessionId: CLAUDE_ID, cwd: project });

    // The chat now points at the real provider session, so the next dispatch
    // resumes that thread instead of spawning one with an empty context.
    const after = q.getChatSessionWithExecution(chatSessionId)!;
    expect(after.externalSessionId).toBe(CLAUDE_ID);
    expect(after.worktreePath).toBe(project);
    // Ledger path and offset describe the imported file, not whatever the live
    // session writes, so reconcile has to re-resolve rather than inherit them.
    expect(after.externalTranscriptPath).toBeNull();
    expect(after.externalSyncOffset).toBeNull();
  });

  it('is idempotent and refuses a chat that was never imported', async () => {
    const chatSessionId = await importFixture();
    const importer = await import('./external-agents');
    const first = importer.takeOverImportedSession(chatSessionId);
    expect(importer.takeOverImportedSession(chatSessionId)).toEqual(first);
    expect(() => importer.takeOverImportedSession('not-an-imported-chat')).toThrow();
  });

  it('never provisions a worktree when an imported chat is continued', async () => {
    const chatSessionId = await importFixture();
    const q = await import('@/lib/db/queries');
    // Legacy shape: imported before executions were pinned to the project
    // folder, so the row looks like an unprovisioned git execution.
    const before = q.getChatSessionWithExecution(chatSessionId)!;
    q.updateExecution(before.executionId!, { worktreePath: null });

    const { continueExecutionSession } = await import('@/lib/sessions/dispatch');
    await continueExecutionSession({ sessionId: chatSessionId });

    const after = q.getChatSessionWithExecution(chatSessionId)!;
    expect(after.setupStartedAt).toBeNull();
    expect(after.worktreePath).toBeNull();
    expect(fs.existsSync(path.join(root, 'flow-root', '.work', 'worktrees'))).toBe(false);
  });

  it('never dispatches from a chat that is still mirroring an import', async () => {
    const chatSessionId = await importFixture();
    const q = await import('@/lib/db/queries');
    // A send that reached the DB but never reached an agent. On any other
    // chat this is the orphan case health check exists to re-fire; on a
    // mirror there is no session to resume, so firing it would fork.
    q.insertChatEvent({
      sessionId: chatSessionId,
      role: 'user',
      source: 'user',
      content: 'are you still there?',
    });

    const { healthCheckSession } = await import('@/lib/executor/health');
    const report = await healthCheckSession(chatSessionId, {
      redispatchOrphans: true,
      force: true,
    });

    expect(report.redispatched).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('never re-fires a question the user left waiting in their terminal', async () => {
    const chatSessionId = await importFixture();
    // A transcript that ends on the user's turn: they asked something in the
    // terminal and walked away. That message is the terminal's to answer.
    appendRecords([
      userRecord('claude-user-2', '2026-03-01T10:08:00.000Z', 'Should I use postgis?'),
    ]);

    const { healthCheckSession } = await import('@/lib/executor/health');
    const report = await healthCheckSession(chatSessionId, {
      redispatchOrphans: true,
      force: true,
    });

    expect(report.replayed).toBe(1);
    expect(report.redispatched).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();

    const q = await import('@/lib/db/queries');
    const last = q.listChatEvents(chatSessionId, { limit: 50 }).at(-1)!;
    expect(last.content).toBe('Should I use postgis?');
    // The discriminator: rows mirrored from a provider transcript carry the
    // provider's own event id. This app's sends don't.
    expect(last.externalEventId).toBe('claude-user-2');
  });

  function appendRecords(records: Record<string, unknown>[]): void {
    fs.appendFileSync(
      transcriptPath,
      `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    );
  }

  function userRecord(uuid: string, timestamp: string, text: string): Record<string, unknown> {
    return {
      type: 'user',
      uuid,
      sessionId: CLAUDE_ID,
      cwd: project,
      gitBranch: 'main',
      timestamp,
      isSidechain: false,
      message: { role: 'user', content: text },
    };
  }

  function assistantRecord(uuid: string, timestamp: string, text: string): Record<string, unknown> {
    return {
      type: 'assistant',
      uuid,
      sessionId: CLAUDE_ID,
      cwd: project,
      timestamp,
      message: {
        id: `msg_${uuid}`,
        role: 'assistant',
        content: [{ type: 'text', text }],
      },
    };
  }
});

function writeJsonl(filePath: string, records: Record<string, unknown>[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
}
