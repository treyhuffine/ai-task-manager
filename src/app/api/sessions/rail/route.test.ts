import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The rail feed's `mainChats` (docs/rail-agents-first.md): each agent's
 * current main chat, what it last said, and, while it's blocked on you, what
 * it's waiting on. The live runtime is stubbed so a pending prompt can be
 * staged; the database is real.
 */

const TEST_DB = path.join(os.tmpdir(), `ri-rail-route-${process.pid}.db`);
const pending = new Map<string, unknown[]>();

vi.mock('@/lib/executor/live-state', () => ({
  listRunningSessions: () => [],
  listBackgroundTaskSessions: () => [],
  listSessionsWithPending: () => [...pending.keys()],
  listForSession: (id: string) => pending.get(id) ?? [],
}));

beforeEach(async () => {
  pending.clear();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(TEST_DB + suffix, { force: true });
  process.env.RI_DB_PATH = TEST_DB;
  const { getDb, resetDb } = await import('@/lib/db');
  resetDb();
  getDb();
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(TEST_DB + suffix, { force: true });
});

async function seed() {
  const q = await import('@/lib/db/queries');
  const ws = q.createWorkspace({ name: 'demo', cwd: os.tmpdir(), isGit: false, filesToCopy: [], status: 'active' });
  const chat = q.createChatSession({ type: 'orchestration', workspaceId: ws.id, harness: 'claude', status: 'active' });
  q.insertChatEvent({ sessionId: chat.id, role: 'assistant', source: 'agent', content: '**Done.** The login page is in.', createdAt: new Date().toISOString() });
  return { ws, chat };
}

async function fetchRail() {
  const { GET } = await import('./route');
  const res = await GET(new Request('http://127.0.0.1/api/sessions/rail'));
  return (await res.json()) as {
    pendingSessionIds: string[];
    mainChats: Array<{ id: string; workspaceId: string; preview: string | null; waitingOn: string | null }>;
  };
}

describe('GET /api/sessions/rail mainChats', () => {
  it("carries each agent's main chat with a plain preview of what it last said", async () => {
    const { ws, chat } = await seed();
    const body = await fetchRail();
    expect(body.mainChats).toEqual([
      expect.objectContaining({ id: chat.id, workspaceId: ws.id, preview: 'Done. The login page is in.', waitingOn: null }),
    ]);
  });

  it("says what a blocked main chat is waiting on, the question it asked", async () => {
    const { chat } = await seed();
    pending.set(chat.id, [
      {
        kind: 'question',
        requestId: 'r1',
        sessionId: chat.id,
        toolUseId: 't1',
        originalInput: {},
        createdAt: new Date().toISOString(),
        questions: [{ question: 'Email links or passwords?', header: 'Login', options: [] }],
      },
    ]);
    const body = await fetchRail();
    expect(body.pendingSessionIds).toContain(chat.id);
    expect(body.mainChats[0].waitingOn).toBe('Email links or passwords?');
  });
});
