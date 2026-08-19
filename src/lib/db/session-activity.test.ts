import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEST_DB = path.join(os.tmpdir(), `flow-session-activity-test-${process.pid}.db`);

beforeEach(async () => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  process.env.FLOW_DB_PATH = TEST_DB;
  const { resetActivityThrottle } = await import('@/lib/sessions/activity');
  resetActivityThrottle();
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

async function setup() {
  const { getDb, resetDb } = await import('@/lib/db');
  resetDb();
  getDb();
  const q = await import('@/lib/db/queries');
  const { uuidv7 } = await import('uuidv7');
  const { workspaces } = await import('@/lib/db/schema');

  const wsId = uuidv7();
  getDb().insert(workspaces).values({
    id: wsId, name: 'Ws', slug: `ws-${Date.now()}`, cwd: '/tmp/ws', isGit: false,
  }).run();
  const executor = q.getOrCreateDefaultExecutor('claude_code');
  const { session } = q.createExecutionWithChat({
    workspaceId: wsId, agentId: executor.id, label: 'Work',
  });
  return { q, session };
}

const activityOf = async (id: string) => {
  const q = await import('@/lib/db/queries');
  return q.getChatSession(id)?.lastActivityAt ?? null;
};

/**
 * Rewind a session's activity so the fixed event timestamps below are
 * strictly later than it. Creation seeds `lastActivityAt` to now, and the
 * bump is monotonic, so without this every assertion would just be reading
 * back the creation time.
 */
const backdate = async (id: string) => {
  const q = await import('@/lib/db/queries');
  q.updateChatSession(id, { lastActivityAt: '2026-01-01T00:00:00.000Z' });
};

describe('lastActivityAt', () => {
  it('is seeded at creation so a new session never sinks to the bottom', async () => {
    // NULL here would sort last under `ORDER BY last_activity_at DESC`.
    const { session } = await setup();
    expect(session.lastActivityAt).toBeTruthy();
    expect(session.lastActivityAt).toBe(session.startedAt);
  });

  it('advances on tool traffic that produces no assistant text', async () => {
    const { q, session } = await setup();
    await backdate(session.id);
    const before = await activityOf(session.id);

    q.insertChatEvent({
      sessionId: session.id, role: 'assistant', source: 'tool_call',
      content: null, toolName: 'Bash', createdAt: '2026-08-13T18:00:00.000Z',
    });

    expect(await activityOf(session.id)).toBe('2026-08-13T18:00:00.000Z');
    // And critically, it did NOT become unread — tool traffic is activity,
    // not output owed review.
    expect(q.getChatSession(session.id)?.lastOutcomeEventAt).toBeNull();
    expect(await activityOf(session.id)).not.toBe(before);
  });

  it('advances on the user\'s own message without marking the chat unread', async () => {
    const { q, session } = await setup();
    await backdate(session.id);

    q.insertChatEvent({
      sessionId: session.id, role: 'user', source: 'user',
      content: 'do the thing', createdAt: '2026-08-13T18:05:00.000Z',
    });

    expect(await activityOf(session.id)).toBe('2026-08-13T18:05:00.000Z');
    expect(q.getChatSession(session.id)?.lastOutcomeEventAt).toBeNull();
  });

  it('does not advance on thinking or system noise', async () => {
    const { q, session } = await setup();
    await backdate(session.id);
    const before = await activityOf(session.id);

    q.insertChatEvent({
      sessionId: session.id, role: 'assistant', source: 'thinking',
      content: 'hmm', createdAt: '2026-08-13T19:00:00.000Z',
    });
    q.insertChatEvent({
      sessionId: session.id, role: 'system', source: 'system',
      content: 'init', createdAt: '2026-08-13T19:00:01.000Z',
    });

    expect(await activityOf(session.id)).toBe(before);
  });

  it('is monotonic so replaying old history cannot yank a live session down', async () => {
    // The reconcile sweep and transcript import both re-insert events with
    // their original timestamps. A plain assignment would rank a session by
    // whatever it happened to replay last.
    const { q, session } = await setup();
    await backdate(session.id);

    q.insertChatEvent({
      sessionId: session.id, role: 'assistant', source: 'agent',
      content: 'recent', createdAt: '2026-08-13T20:00:00.000Z',
    });
    q.insertChatEvent({
      sessionId: session.id, role: 'assistant', source: 'agent',
      content: 'ancient replay', createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(await activityOf(session.id)).toBe('2026-08-13T20:00:00.000Z');
  });

  it('advances on mark-unread but NOT on mark-read', async () => {
    // markRead fires on open (the composer autofocuses), so bumping there
    // would make merely clicking a rail row re-sort the rail.
    const { q, session } = await setup();

    // Backdate first, like every other case here. Comparing against
    // `startedAt` instead made the assertion depend on creation and
    // mark-unread landing in different milliseconds, which holds right up
    // until something else slows the suite down.
    await backdate(session.id);
    q.markSessionUnread(session.id);
    const afterUnread = await activityOf(session.id);
    expect(afterUnread).not.toBe('2026-01-01T00:00:00.000Z');

    q.markSessionRead(session.id);
    expect(await activityOf(session.id)).toBe(afterUnread);
  });

  it('ranks a month-old session worked on today above a newer idle one', async () => {
    // The end-to-end statement of the whole feature.
    const { q } = await setup();
    const { sortSessionsHotnessDesc } = await import('@/lib/utils/session-sort');
    const { getDb } = await import('@/lib/db');
    const { workspaces } = await import('@/lib/db/schema');
    const { uuidv7 } = await import('uuidv7');

    const wsId = uuidv7();
    getDb().insert(workspaces).values({
      id: wsId, name: 'Ws2', slug: `ws2-${Date.now()}`, cwd: '/tmp/ws2', isGit: false,
    }).run();
    const executor = q.getOrCreateDefaultExecutor('claude_code');

    const monthOld = q.createExecutionWithChat({
      workspaceId: wsId, agentId: executor.id, label: 'Month old',
    }).session;
    const newer = q.createExecutionWithChat({
      workspaceId: wsId, agentId: executor.id, label: 'Newer idle',
    }).session;
    // Backdate both: creation seeds `startedAt` and `lastActivityAt` to now,
    // so we rewind them to model "opened a month ago" vs "opened yesterday".
    // Straight to the table because `startedAt` is deliberately omitted from
    // `UpdateChatSessionInput` — creation time is not editable in the app.
    const { chatSessions } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');
    for (const [id, at] of [
      [monthOld.id, '2026-07-13T00:00:00.000Z'],
      [newer.id, '2026-08-12T00:00:00.000Z'],
    ] as const) {
      getDb().update(chatSessions)
        .set({ startedAt: at, lastActivityAt: at })
        .where(eq(chatSessions.id, id))
        .run();
    }

    // The old one gets worked on today — a tool call, nothing else.
    q.insertChatEvent({
      sessionId: monthOld.id, role: 'assistant', source: 'tool_call',
      content: null, toolName: 'Edit', createdAt: '2026-08-13T16:00:00.000Z',
    });

    const rows = [monthOld.id, newer.id].map((id) => q.getChatSession(id)!);
    const sorted = sortSessionsHotnessDesc(rows);
    expect(sorted[0]!.label).toBe('Month old');
  });
});
