import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Integration tests for chat/session full-text search (`searchChatSessions`)
 * and the `chat_events_fts` index that backs it. Uses a throwaway on-disk DB
 * (FLOW_DB_PATH) so the real migrate() + EXTRA_SQL path builds the FTS table
 * and triggers exactly as production would.
 *
 * Covers:
 *   - a content match returns the session with a highlighted snippet
 *   - only message-bearing events are indexed (tool_result/thinking excluded)
 *   - archived + imported chats are searchable, and the status/source filters
 *   - multiple matching events collapse to one result per session
 *   - the one-shot backfill indexes rows that predate the index (upgrade path)
 */

interface SeedEvent {
  source: string;
  content: string;
  role?: string;
}

describe('chat/session search', () => {
  let root: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-chat-search-'));
    const env: Record<string, string> = {
      FLOW_ROOT: path.join(root, 'flow-root'),
      FLOW_DB_PATH: path.join(root, 'flow.db'),
      FLOW_MIRROR_DISABLED: '1',
    };
    for (const [key, value] of Object.entries(env)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
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

  /** Seed one execution chat + its events (events inserted directly so the DB
   *  trigger — not app code — is what indexes them). Returns the session id. */
  async function seedSession(opts: {
    label?: string;
    status?: 'active' | 'archived';
    surfaceKind?: string | null;
    surfaceRef?: string | null;
    workspaceId?: string | null;
    events: SeedEvent[];
  }): Promise<string> {
    const { getDb } = await import('@/lib/db');
    const q = await import('@/lib/db/queries');
    const { chatEvents } = await import('@/lib/db/schema');

    const agent = q.getOrCreateDefaultExecutor('claude_code');
    const session = q.createChatSession({
      agentId: agent.id,
      type: 'execution',
      status: opts.status ?? 'active',
      surfaceKind: opts.surfaceKind ?? null,
      surfaceRef: opts.surfaceRef ?? null,
      workspaceId: opts.workspaceId ?? null,
      label: opts.label ?? 'Test session',
    });

    const db = getDb();
    for (const ev of opts.events) {
      db.insert(chatEvents)
        .values({
          id: crypto.randomUUID(),
          sessionId: session.id,
          role: ev.role ?? (ev.source === 'user' ? 'user' : 'assistant'),
          source: ev.source,
          content: ev.content,
        })
        .run();
    }
    return session.id;
  }

  it('finds a session by message content and returns a highlighted snippet', async () => {
    const q = await import('@/lib/db/queries');
    const { CHAT_SEARCH_HL_START, CHAT_SEARCH_HL_END } = await import('@/lib/search/highlight');
    const sessionId = await seedSession({
      label: 'Fox chat',
      events: [
        { source: 'user', content: 'how do I handle the quick brown fox problem' },
        { source: 'agent', content: 'You jump over the lazy dog like so.' },
      ],
    });

    const results = q.searchChatSessions({ query: 'brown' });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(sessionId);
    expect(results[0]!.score).toBeGreaterThan(0);
    // Snippet carries the matched term wrapped in the highlight sentinels.
    expect(results[0]!.snippet).toContain(
      `${CHAT_SEARCH_HL_START}brown${CHAT_SEARCH_HL_END}`,
    );
    // Matched event is the user turn that contained "brown".
    expect(results[0]!.matchedEventId).toBeTruthy();
  });

  it('matches assistant (agent) turns too', async () => {
    const q = await import('@/lib/db/queries');
    await seedSession({
      events: [
        { source: 'user', content: 'unrelated question' },
        { source: 'agent', content: 'The authentication middleware rejects the token.' },
      ],
    });
    const results = q.searchChatSessions({ query: 'authentication' });
    expect(results).toHaveLength(1);
  });

  it('does NOT index tool_result, thinking, or system events', async () => {
    const q = await import('@/lib/db/queries');
    await seedSession({
      events: [
        { source: 'user', content: 'ordinary message' },
        { source: 'tool_result', content: 'zzytoolonly matched inside a tool result' },
        { source: 'thinking', content: 'zzythinkonly reasoning trace' },
        { source: 'system', content: 'zzysystemonly plumbing' },
      ],
    });
    expect(q.searchChatSessions({ query: 'zzytoolonly' })).toHaveLength(0);
    expect(q.searchChatSessions({ query: 'zzythinkonly' })).toHaveLength(0);
    expect(q.searchChatSessions({ query: 'zzysystemonly' })).toHaveLength(0);
    // Sanity: the indexed user message is still findable.
    expect(q.searchChatSessions({ query: 'ordinary' })).toHaveLength(1);
  });

  it('searches archived + imported chats by default, and honors the filters', async () => {
    const q = await import('@/lib/db/queries');
    const nativeId = await seedSession({
      label: 'Native active',
      status: 'active',
      events: [{ source: 'agent', content: 'refactor the widget pipeline' }],
    });
    const importedId = await seedSession({
      label: 'Imported archived',
      status: 'archived',
      surfaceKind: 'imported_agent',
      surfaceRef: 'claude',
      events: [{ source: 'agent', content: 'refactor the widget renderer' }],
    });

    // Default: both active + archived, native + imported.
    const all = q.searchChatSessions({ query: 'refactor' });
    expect(all.map((r) => r.id).sort()).toEqual([nativeId, importedId].sort());

    // status filter.
    expect(q.searchChatSessions({ query: 'refactor', status: 'active' }).map((r) => r.id)).toEqual([
      nativeId,
    ]);
    expect(
      q.searchChatSessions({ query: 'refactor', status: 'archived' }).map((r) => r.id),
    ).toEqual([importedId]);

    // source filter.
    expect(
      q.searchChatSessions({ query: 'refactor', source: 'imported' }).map((r) => r.id),
    ).toEqual([importedId]);
    expect(q.searchChatSessions({ query: 'refactor', source: 'native' }).map((r) => r.id)).toEqual([
      nativeId,
    ]);
    expect(q.searchChatSessions({ query: 'refactor', source: 'claude' }).map((r) => r.id)).toEqual([
      importedId,
    ]);
    expect(q.searchChatSessions({ query: 'refactor', source: 'codex' })).toHaveLength(0);
  });

  it('filters OpenCode imports specifically without changing the generic imported filter', async () => {
    const q = await import('@/lib/db/queries');
    const claudeId = await seedSession({
      status: 'archived',
      surfaceKind: 'imported_agent',
      surfaceRef: 'claude',
      events: [{ source: 'agent', content: 'providerfacet shared transcript term' }],
    });
    const openCodeId = await seedSession({
      status: 'archived',
      surfaceKind: 'imported_agent',
      surfaceRef: 'opencode',
      events: [{ source: 'agent', content: 'providerfacet shared transcript term' }],
    });

    expect(
      q.searchChatSessions({ query: 'providerfacet', source: 'imported' })
        .map((result) => result.id)
        .sort(),
    ).toEqual([claudeId, openCodeId].sort());
    expect(
      q.searchChatSessions({ query: 'providerfacet', source: 'opencode' })
        .map((result) => result.id),
    ).toEqual([openCodeId]);
    expect(q.searchChatSessions({ query: 'providerfacet', source: 'claude' })
      .map((result) => result.id)).toEqual([claudeId]);

    const { NextRequest } = await import('next/server');
    const { GET } = await import('@/app/api/sessions/search/route');
    const response = await GET(new NextRequest(
      'http://localhost/api/sessions/search?q=providerfacet&source=opencode',
    ));
    expect(response.status).toBe(200);
    expect((await response.json() as Array<{ id: string }>).map((result) => result.id))
      .toEqual([openCodeId]);
  });

  it('collapses multiple matching events into one result per session', async () => {
    const q = await import('@/lib/db/queries');
    await seedSession({
      events: [
        { source: 'user', content: 'deadbeef appears here' },
        { source: 'agent', content: 'deadbeef appears again' },
        { source: 'user', content: 'and deadbeef once more' },
      ],
    });
    const results = q.searchChatSessions({ query: 'deadbeef' });
    expect(results).toHaveLength(1);
  });

  it('returns nothing for a blank query', async () => {
    const q = await import('@/lib/db/queries');
    await seedSession({ events: [{ source: 'user', content: 'anything' }] });
    expect(q.searchChatSessions({ query: '   ' })).toHaveLength(0);
  });

  it('backfills events that predate the index (upgrade path)', async () => {
    const { getDb, getRawDb, resetDb } = await import('@/lib/db');
    const q = await import('@/lib/db/queries');
    const { chatEvents } = await import('@/lib/db/schema');

    // Session exists; simulate a DB from before the FTS feature by dropping the
    // index + triggers, THEN inserting events (so nothing indexes them live).
    const agent = q.getOrCreateDefaultExecutor('claude_code');
    const session = q.createChatSession({
      agentId: agent.id,
      type: 'execution',
      status: 'active',
      label: 'Legacy session',
    });

    const raw = getRawDb();
    raw.exec(`
      DROP TRIGGER IF EXISTS chat_events_fts_ai;
      DROP TRIGGER IF EXISTS chat_events_fts_ad;
      DROP TRIGGER IF EXISTS chat_events_fts_au;
      DROP TABLE IF EXISTS chat_events_fts;
    `);

    const db = getDb();
    db.insert(chatEvents)
      .values({
        id: crypto.randomUUID(),
        sessionId: session.id,
        role: 'assistant',
        source: 'agent',
        content: 'legacy content mentioning kubernetes deployment',
      })
      .run();

    // Nothing indexed it yet — reopen so EXTRA_SQL recreates the index and the
    // one-shot backfill picks up the pre-existing row.
    resetDb();
    const results = q.searchChatSessions({ query: 'kubernetes' });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(session.id);
  });
});
