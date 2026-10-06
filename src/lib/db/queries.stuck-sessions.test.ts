/**
 * `listSessionsAwaitingAuth` — the "sessions paused for login" card's
 * query. Covers which sessions count as stuck (latest event by
 * `(createdAt, id)`), the last-user-message preview, and that the plan
 * stays index-driven: the card polls this every 30s on the server's only
 * thread, and the old full-table window ranking stalled every request.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { APP_SHORT_ID } from '@/constants/app';

describe('listSessionsAwaitingAuth', () => {
  let tmpDir: string;
  const appRootEnv = `${APP_SHORT_ID.toUpperCase()}_ROOT`;
  const dbPathEnv = `${APP_SHORT_ID.toUpperCase()}_DB_PATH`;
  const mirrorDisabledEnv = `${APP_SHORT_ID.toUpperCase()}_MIRROR_DISABLED`;
  const saveEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-queries-stuck-'));
    for (const k of [appRootEnv, dbPathEnv, mirrorDisabledEnv]) saveEnv[k] = process.env[k];
    process.env[appRootEnv] = tmpDir;
    process.env[dbPathEnv] = path.join(tmpDir, 'data.db');
    process.env[mirrorDisabledEnv] = '1';
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const k of [appRootEnv, dbPathEnv, mirrorDisabledEnv]) {
      if (saveEnv[k] === undefined) delete process.env[k];
      else process.env[k] = saveEnv[k];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const at = (s: number) => `2026-01-01T00:00:${String(s).padStart(2, '0')}.000Z`;

  async function load() {
    const q = await import('@/lib/db/queries');
    const { getRawDb } = await import('@/lib/db');
    const session = () => q.createChatSession({ harness: 'claude', type: 'execution', userId: 'local' }).id;
    const event = (
      sessionId: string,
      source: 'user' | 'agent' | 'auth_required',
      second: number,
      extra: { content?: string; attachments?: Parameters<typeof q.insertChatEvent>[0]['attachments'] } = {},
    ) => {
      const row = q.insertChatEvent({
        sessionId,
        role: source === 'user' ? 'user' : 'assistant',
        source,
        content: extra.content ?? source,
        createdAt: at(second),
        ...(extra.attachments ? { attachments: extra.attachments } : {}),
      });
      expect(row).not.toBeNull();
      return row!;
    };
    // Pin the rail sort key so ordering doesn't depend on which sources
    // the activity policy bumps.
    const setActivity = (sessionId: string, second: number) =>
      getRawDb().prepare('UPDATE chat_sessions SET last_activity_at = ? WHERE id = ?').run(at(second), sessionId);
    return { q, getRawDb, session, event, setActivity };
  }

  it('lists a session whose latest event is auth_required, with its last user message', async () => {
    const { q, session, event } = await load();
    const id = session();
    event(id, 'user', 1, { content: 'first ask' });
    event(id, 'agent', 2);
    const lastUser = event(id, 'user', 3, {
      content: 'second ask',
      attachments: [{
        fileName: 'a.png',
        originalName: 'shot.png',
        mimeType: 'image/png',
        size: 12,
        uploadedAt: at(3),
      }],
    });
    event(id, 'auth_required', 4);

    const rows = q.listSessionsAwaitingAuth();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sessionId).toBe(id);
    expect(rows[0]!.last_user_event_id).toBe(lastUser.id);
    expect(rows[0]!.last_user_content).toBe('second ask');
    expect(JSON.parse(rows[0]!.last_user_attachments!)).toEqual([
      expect.objectContaining({ file_name: 'a.png', mime_type: 'image/png' }),
    ]);
  });

  it('skips a session that moved past auth_required', async () => {
    const { q, session, event } = await load();
    const id = session();
    event(id, 'user', 1);
    event(id, 'auth_required', 2);
    event(id, 'agent', 3);
    expect(q.listSessionsAwaitingAuth()).toEqual([]);
  });

  it('skips archived sessions and sessions with no events', async () => {
    const { q, session, event } = await load();
    const archived = session();
    event(archived, 'user', 1);
    event(archived, 'auth_required', 2);
    q.archiveChatSession(archived);
    session();
    expect(q.listSessionsAwaitingAuth()).toEqual([]);
  });

  it('breaks a same-timestamp tie by id, like the transcript', async () => {
    const { q, session, event } = await load();
    // Same second, auth_required inserted last: its later UUIDv7 makes it
    // the latest event.
    const stuck = session();
    event(stuck, 'user', 1);
    event(stuck, 'agent', 2);
    event(stuck, 'auth_required', 2);
    // Same second, agent inserted last: no longer stuck.
    const moved = session();
    event(moved, 'user', 1);
    event(moved, 'auth_required', 2);
    event(moved, 'agent', 2);

    expect(q.listSessionsAwaitingAuth().map((r) => r.sessionId)).toEqual([stuck]);
  });

  it('returns a null preview when the session has no user message', async () => {
    const { q, session, event } = await load();
    const id = session();
    event(id, 'agent', 1);
    event(id, 'auth_required', 2);
    const [row] = q.listSessionsAwaitingAuth();
    expect(row).toMatchObject({ sessionId: id, last_user_event_id: null, last_user_content: null });
  });

  it('orders by latest activity, newest first', async () => {
    const { q, session, event, setActivity } = await load();
    const older = session();
    const newer = session();
    for (const id of [older, newer]) {
      event(id, 'user', 1);
      event(id, 'auth_required', 2);
    }
    setActivity(older, 10);
    setActivity(newer, 20);
    expect(q.listSessionsAwaitingAuth().map((r) => r.sessionId)).toEqual([newer, older]);
  });

  it('finds candidates through the paused-on-sign-in index, and reads chat_events only by index', async () => {
    const { q, getRawDb } = await load();
    const db = getRawDb();
    const prepare = vi.spyOn(db, 'prepare');
    q.listSessionsAwaitingAuth();
    const sql = prepare.mock.calls.map(([s]) => s).find((s) => s.includes('chat_events'));
    expect(sql).toBeDefined();
    prepare.mockRestore();

    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((r) => r.detail);
    const eventReads = plan.filter((d) => /\b(chat_events|e|u|lu)\b/.test(d) && /^(SCAN|SEARCH)\b/.test(d));
    // The candidates: a scan of the partial index, which holds only auth_required rows.
    expect(eventReads).toContain('SCAN chat_events USING COVERING INDEX idx_chat_events_auth_required');
    // Every other read is a keyed search, never a walk of the table.
    for (const d of eventReads.filter((d) => !d.includes('idx_chat_events_auth_required'))) {
      expect(d).toMatch(/^SEARCH .* USING (COVERING )?INDEX /);
    }
    expect(plan.some((d) => d.startsWith('MATERIALIZE'))).toBe(false);
  });
});
