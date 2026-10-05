/**
 * The work ledger against a real database: the reads it makes (and their
 * plans, per AGENTS.md "Query cost"), folding new events in incrementally,
 * and the file surviving a restart.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { APP_SHORT_ID } from '@/constants/app';

describe('work ledger', () => {
  let tmpDir: string;
  const envs = [`${APP_SHORT_ID.toUpperCase()}_ROOT`, `${APP_SHORT_ID.toUpperCase()}_DB_PATH`, `${APP_SHORT_ID.toUpperCase()}_MIRROR_DISABLED`];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-work-ledger-'));
    for (const k of envs) saved[k] = process.env[k];
    process.env[envs[0]!] = tmpDir;
    process.env[envs[1]!] = path.join(tmpDir, 'data.db');
    process.env[envs[2]!] = '1';
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of envs) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 9, minute)).toISOString();

  async function load() {
    const q = await import('@/lib/db/queries');
    const { getRawDb } = await import('@/lib/db');
    const ledger = await import('./ledger');
    const sessionId = q.createChatSession({ harness: 'claude', type: 'execution', userId: 'local' }).id;
    const event = (source: 'user' | 'agent' | 'tool_call' | 'system', minute: number, content: string = source, senderSessionId?: string) =>
      q.insertChatEvent({
        sessionId,
        role: source === 'user' ? 'user' : 'assistant',
        source,
        content,
        createdAt: at(minute),
        ...(senderSessionId ? { senderSessionId } : {}),
      })!;
    return { q, db: getRawDb(), ledger, sessionId, event };
  }

  it('reads work events after a cursor by rowid, and senders only on messages', async () => {
    const { q, event, sessionId } = await load();
    const first = event('user', 0, 'fix the rail');
    event('system', 1);
    event('agent', 2, 'done, three files changed');
    const rows = q.listWorkEventsAfterRowid(0, 100);
    expect(rows.map((r) => r.source)).toEqual(['user', 'agent']);
    expect(rows[0]).toMatchObject({ sessionId, text: 'fix the rail', senderSessionId: null });
    const after = q.listWorkEventsAfterRowid(rows[0]!.rowid, 100);
    expect(after.map((r) => r.source)).toEqual(['agent']);
    expect(first.id).toBeTruthy();
  });

  it('keeps both reads on an index (AGENTS.md, "Query cost")', async () => {
    const { q, db } = await load();
    const plan = (sql: string, ...args: unknown[]) =>
      (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as { detail: string }[]).map((r) => r.detail);
    expect(plan(q.WORK_EVENTS_AFTER_ROWID_SQL, 0, 10)).toEqual(['SEARCH chat_events USING INTEGER PRIMARY KEY (rowid>?)']);
    const bySession = plan(q.WORK_EVENTS_FOR_SESSION_SQL, 's');
    expect(bySession[0]).toMatch(/^SEARCH chat_events USING INDEX idx_chat_events_session_created \(session_id=\?\)/);
    expect(bySession.some((d) => d.startsWith('SCAN'))).toBe(false);
  });

  it('folds new events in, writes the file, and reloads it after a restart', async () => {
    const { ledger, event } = await load();
    event('user', 0, 'ship the calendar');
    event('agent', 3, 'on it');
    event('tool_call', 6);
    let blocks = await ledger.readLedger();
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ busyMs: 6 * 60_000, yourWords: 3, agentWords: 2 });

    // 45 minutes later: a second block. Only the new rows are read.
    event('agent', 51);
    blocks = await ledger.readLedger();
    expect(blocks).toHaveLength(2);

    const file = JSON.parse(fs.readFileSync(ledger.ledgerPath(), 'utf8'));
    expect(file.blocks).toHaveLength(2);
    expect(file.cursor).toBeGreaterThan(0);

    // A restart forgets memory; the file carries on.
    ledger.resetLedgerMemory();
    expect(await ledger.readLedger()).toEqual(blocks);
  });

  it('rebuilds a chat when older history arrives after it', async () => {
    const { ledger, event } = await load();
    event('agent', 200);
    await ledger.readLedger();
    // An import lands events from hours earlier, after the cursor moved on.
    event('user', 0, 'imported question');
    event('agent', 2, 'imported answer');
    const blocks = await ledger.readLedger();
    expect(blocks.map((b) => b.start)).toEqual([Date.parse(at(0)), Date.parse(at(200))]);
    expect(blocks[0]!.yourWords).toBe(2);
  });

  it('a message from another chat is not yours', async () => {
    const { q, ledger, event } = await load();
    const other = q.createChatSession({ harness: 'claude', type: 'execution', userId: 'local' }).id;
    event('user', 0, 'please check the build', other);
    const [block] = await ledger.readLedger();
    expect(block!.touches).toEqual([]);
    expect(block!.yourWords).toBe(0);
  });
});
