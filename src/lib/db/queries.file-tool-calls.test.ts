/**
 * `fileToolCallNamed`: the check behind opening a file outside a chat's folder
 * from its transcript (`src/lib/sessions/named-files.ts`). Covers which tool
 * calls count (file tools naming that exact absolute path, in any chat on the
 * execution) and that the read stays on the session index, since it runs on
 * the server's only thread and `chat_events` is the big table.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEST_DB = path.join(os.tmpdir(), `ri-file-tool-calls-test-${process.pid}.db`);

beforeEach(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  process.env.RI_DB_PATH = TEST_DB;
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

async function setup() {
  const { getDb, getRawDb, resetDb } = await import('@/lib/db');
  resetDb();
  getDb();
  const q = await import('@/lib/db/queries');
  const { workspaces } = await import('@/lib/db/schema');
  const { uuidv7 } = await import('uuidv7');
  const wsId = uuidv7();
  getDb().insert(workspaces).values({
    id: wsId, name: 'Ws', slug: `ws-${wsId}`, cwd: '/tmp/ws', isGit: false, status: 'active', filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: true,
  }).run();
  const execution = () => q.createExecutionWithChat({ workspaceId: wsId, harness: 'claude', label: 'Work' });
  const toolCall = (sessionId: string, toolName: string, toolInput: unknown) =>
    q.insertChatEvent({ sessionId, role: 'assistant', source: 'tool_call', content: '', toolName, toolInput });
  return { q, getRawDb, wsId, execution, toolCall };
}

describe('fileToolCallNamed', () => {
  it('finds a file tool that named the exact absolute path', async () => {
    const { q, execution, toolCall } = await setup();
    const { execution: ex, session: chatSession } = execution();
    const scope = { sessionId: chatSession.id, executionId: ex.id };
    toolCall(chatSession.id, 'Read', { file_path: '/tmp/ri-work/shots/s2-border.png' });

    expect(q.fileToolCallNamed(scope, '/tmp/ri-work/shots/s2-border.png')).toBe(true);
    // A longer name that contains it is a different file.
    expect(q.fileToolCallNamed(scope, '/tmp/ri-work/shots/s2-border')).toBe(false);
    expect(q.fileToolCallNamed(scope, '/tmp/ri-work/shots/s2.png')).toBe(false);
    expect(q.fileToolCallNamed(scope, '')).toBe(false);
  });

  it('counts writes, edits and patches, and paths with characters JSON escapes', async () => {
    const { q, execution, toolCall } = await setup();
    const { execution: ex, session: chatSession } = execution();
    const scope = { sessionId: chatSession.id, executionId: ex.id };
    toolCall(chatSession.id, 'Write', { file_path: '/tmp/notes/plan.md', content: 'x' });
    toolCall(chatSession.id, 'Edit', { file_path: '/tmp/My "quoted" file.txt', old_string: 'a', new_string: 'b' });
    toolCall(chatSession.id, 'apply_patch', { input: '*** Begin Patch\n*** Update File: /tmp/patched.ts\n@@\n-a\n+b\n*** End Patch' });

    expect(q.fileToolCallNamed(scope, '/tmp/notes/plan.md')).toBe(true);
    expect(q.fileToolCallNamed(scope, '/tmp/My "quoted" file.txt')).toBe(true);
    expect(q.fileToolCallNamed(scope, '/tmp/patched.ts')).toBe(true);
  });

  it('ignores a path that only appears in other tools, or as a relative path', async () => {
    const { q, execution, toolCall } = await setup();
    const { execution: ex, session: chatSession } = execution();
    const scope = { sessionId: chatSession.id, executionId: ex.id };
    toolCall(chatSession.id, 'Bash', { command: 'cat /Users/agent/.ssh/id_ed25519' });
    toolCall(chatSession.id, 'Grep', { pattern: 'x', path: '/etc/hosts' });
    toolCall(chatSession.id, 'Read', { file_path: 'tmp/relative.png' });

    expect(q.fileToolCallNamed(scope, '/Users/agent/.ssh/id_ed25519')).toBe(false);
    expect(q.fileToolCallNamed(scope, '/etc/hosts')).toBe(false);
    expect(q.fileToolCallNamed(scope, '/tmp/relative.png')).toBe(false);
  });

  it("reaches every chat on the execution, and no other execution's", async () => {
    const { q, wsId, execution, toolCall } = await setup();
    const first = execution();
    const other = execution();
    const sibling = q.createChatSession({ type: 'execution', harness: 'claude', label: 'Second chat', status: 'active' });
    q.updateChatSession(sibling.id, { executionId: first.execution.id, workspaceId: wsId });
    toolCall(sibling.id, 'Read', { file_path: '/tmp/from-sibling.png' });
    toolCall(other.session.id, 'Read', { file_path: '/tmp/from-other.png' });

    const scope = { sessionId: first.session.id, executionId: first.execution.id };
    expect(q.fileToolCallNamed(scope, '/tmp/from-sibling.png')).toBe(true);
    expect(q.fileToolCallNamed(scope, '/tmp/from-other.png')).toBe(false);
    // A chat with no execution sees only itself.
    const loose = q.createChatSession({ type: 'orchestration', harness: 'claude', label: 'Main', status: 'active' });
    toolCall(loose.id, 'Read', { file_path: '/tmp/loose.png' });
    expect(q.fileToolCallNamed({ sessionId: loose.id, executionId: null }, '/tmp/loose.png')).toBe(true);
    expect(q.fileToolCallNamed({ sessionId: loose.id, executionId: null }, '/tmp/from-sibling.png')).toBe(false);
  });

  it('reads chat_events through the session index', async () => {
    const { q, getRawDb, execution } = await setup();
    const { execution: ex, session: chatSession } = execution();
    const db = getRawDb();
    const prepare = vi.spyOn(db, 'prepare');
    q.fileToolCallNamed({ sessionId: chatSession.id, executionId: ex.id }, '/tmp/a.png');
    const sql = prepare.mock.calls.map(([s]) => s).find((s) => s.includes('chat_events'));
    expect(sql).toBeDefined();
    prepare.mockRestore();

    const params = Array.from({ length: (sql!.match(/\?/g) ?? []).length }, () => null);
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[]).map((r) => r.detail);
    const eventReads = plan.filter((d) => /\bchat_events\b/.test(d) && /^(SCAN|SEARCH)\b/.test(d));
    expect(eventReads).toEqual(['SEARCH chat_events USING INDEX idx_chat_events_session_created (session_id=?)']);
  });
});
