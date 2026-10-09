import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openAsServer } from '@/test/fixtures/home';

/**
 * Integration tests for chat/session full-text search (`searchChatSessions`)
 * and the `chat_events_fts` index that backs it. Uses a throwaway on-disk DB
 * (RI_DB_PATH) so the real migrate() + EXTRA_SQL path builds the FTS table
 * and triggers exactly as production would.
 *
 * Covers:
 *   - a content match returns the session with a highlighted snippet
 *   - only message-bearing events are indexed (tool_result/thinking excluded)
 *   - archived + imported chats are searchable, and the status/source filters
 *   - the agent filter, on search and on the recent feed it falls back to
 *   - titles: the chat's own or its execution's, ranked before messages
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
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-chat-search-'));
    const env: Record<string, string> = {
      RI_ROOT: path.join(root, 'ri-root'),
      RI_DB_PATH: path.join(root, 'ri.db'),
      RI_MIRROR_DISABLED: '1',
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
    label?: string | null;
    status?: 'active' | 'archived';
    surfaceKind?: string | null;
    surfaceRef?: string | null;
    workspaceId?: string | null;
    executionId?: string | null;
    events: SeedEvent[];
  }): Promise<string> {
    const { getDb } = await import('@/lib/db');
    const q = await import('@/lib/db/queries');
    const { chatEvents } = await import('@/lib/db/schema');

    const session = q.createChatSession({
      harness: 'claude',
      type: 'execution',
      status: opts.status ?? 'active',
      surfaceKind: opts.surfaceKind ?? null,
      surfaceRef: opts.surfaceRef ?? null,
      workspaceId: opts.workspaceId ?? null,
      executionId: opts.executionId ?? null,
      label: opts.label === undefined ? 'Test session' : opts.label,
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

  /** An agent (workspace) to file chats under. */
  async function seedAgent(name: string): Promise<string> {
    const q = await import('@/lib/db/queries');
    return q.createWorkspace({ name, cwd: root, isGit: false, filesToCopy: [], status: 'active' }).id;
  }

  it('scopes search to one agent', async () => {
    const q = await import('@/lib/db/queries');
    const ri = await seedAgent('Ri');
    const site = await seedAgent('Site');
    const riChat = await seedSession({
      workspaceId: ri,
      events: [{ source: 'agent', content: 'agentfacet migration plan' }],
    });
    const siteChat = await seedSession({
      workspaceId: site,
      status: 'archived',
      events: [{ source: 'agent', content: 'agentfacet landing page' }],
    });

    expect(q.searchChatSessions({ query: 'agentfacet' }).map((r) => r.id).sort()).toEqual(
      [riChat, siteChat].sort(),
    );
    expect(q.searchChatSessions({ query: 'agentfacet', workspaceId: ri }).map((r) => r.id)).toEqual([riChat]);
    // Archived chats stay in an agent's scope, and the facets combine.
    expect(q.searchChatSessions({ query: 'agentfacet', workspaceId: site }).map((r) => r.id)).toEqual([siteChat]);
    expect(q.searchChatSessions({ query: 'agentfacet', workspaceId: site, status: 'active' })).toHaveLength(0);

    const { NextRequest } = await import('next/server');
    const { GET } = await import('@/app/api/sessions/search/route');
    const response = await GET(new NextRequest(
      `http://localhost/api/sessions/search?q=agentfacet&workspaceId=${ri}`,
    ));
    expect(response.status).toBe(200);
    expect((await response.json() as Array<{ id: string }>).map((r) => r.id)).toEqual([riChat]);
  });

  it("scopes the recent feed to one agent before its cap, so a quiet agent's chats still show", async () => {
    const q = await import('@/lib/db/queries');
    const busy = await seedAgent('Busy');
    const quiet = await seedAgent('Quiet');
    const quietChat = await seedSession({ workspaceId: quiet, events: [] });
    const busyChats: string[] = [];
    for (let i = 0; i < 3; i++) busyChats.push(await seedSession({ workspaceId: busy, events: [] }));
    // The quiet agent's chat is the oldest, and the busy agent's are all newer.
    const { getRawDb } = await import('@/lib/db');
    const touch = getRawDb().prepare('UPDATE chat_sessions SET last_activity_at = ? WHERE id = ?');
    touch.run('2026-10-01T09:00:00.000Z', quietChat);
    busyChats.forEach((id, i) => touch.run(`2026-10-0${2 + i}T09:00:00.000Z`, id));

    // Unscoped, the newest rows across every agent fill the cap.
    const newest = q.listHistorySessions({ limit: 3 }).map((r) => r.id);
    expect(newest).not.toContain(quietChat);
    // Scoped, the quiet agent's chat is there, with the agent's identity
    // joined on for the row's avatar and name.
    const scoped = q.listHistorySessions({ limit: 3, workspaceId: quiet });
    expect(scoped.map((r) => r.id)).toEqual([quietChat]);
    expect(scoped[0]!.workspaceName).toBe('Quiet');
    expect(q.listHistorySessions({ workspaceId: busy }).map((r) => r.id).sort()).toEqual(busyChats.sort());

    const { NextRequest } = await import('next/server');
    const { GET } = await import('@/app/api/sessions/history/route');
    const scopedResponse = await GET(new NextRequest(`http://localhost/api/sessions/history?workspaceId=${quiet}`));
    expect(scopedResponse.status).toBe(200);
    expect((await scopedResponse.json() as { sessions: Array<{ id: string }> }).sessions.map((r) => r.id))
      .toEqual([quietChat]);
    const allResponse = await GET(new NextRequest('http://localhost/api/sessions/history'));
    expect((await allResponse.json() as { sessions: unknown[] }).sessions).toHaveLength(4);
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
    const { getDb, getRawDb } = await import('@/lib/db');
    const q = await import('@/lib/db/queries');
    const { chatEvents } = await import('@/lib/db/schema');

    // Session exists; simulate a DB from before the FTS feature by dropping the
    // index + triggers, THEN inserting events (so nothing indexes them live).
    const session = q.createChatSession({
      harness: 'claude',
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

    // Nothing indexed it yet. Start as the server does, so EXTRA_SQL
    // recreates the index and the one-shot backfill picks up the old row.
    await openAsServer();
    const results = q.searchChatSessions({ query: 'kubernetes' });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(session.id);
  });

  it('skips the backfill, and its read of every event, once the index has rows', async () => {
    const { getDb, resetDb } = await import('@/lib/db');
    const q = await import('@/lib/db/queries');
    const { default: Database } = await import('better-sqlite3');
    const session = q.createChatSession({ harness: 'claude', type: 'execution', status: 'active', label: 'Trigger check' });
    q.insertChatEvent({ sessionId: session.id, role: 'user', source: 'user', content: 'already indexed by the trigger' });

    resetDb();
    const exec = vi.spyOn(Database.prototype, 'exec');
    try {
      getDb();
      // The backfill is the one statement that reads chat_events into the
      // index (the triggers' own INSERTs read NEW.*, not the table).
      const backfills = exec.mock.calls.map(([sql]) => String(sql)).filter((sql) => /FROM chat_events\s+WHERE/.test(sql));
      expect(backfills).toEqual([]);
    } finally {
      exec.mockRestore();
    }
    expect(q.searchChatSessions({ query: 'indexed' })).toHaveLength(1);
  });

  // ── Titles ──────────────────────────────────────────────────

  /** Set when a chat last did anything, which orders title matches of one rank. */
  async function setActivity(sessionId: string, at: string): Promise<void> {
    const { getRawDb } = await import('@/lib/db');
    getRawDb().prepare('UPDATE chat_sessions SET last_activity_at = ? WHERE id = ?').run(at, sessionId);
  }

  it('finds a chat by its title when no message mentions it', async () => {
    const q = await import('@/lib/db/queries');
    const id = await seedSession({
      label: 'Quarterly roadmap review',
      events: [{ source: 'user', content: 'hello there' }],
    });

    const [hit, ...rest] = q.searchChatSessions({ query: 'roadmap' });
    expect(rest).toHaveLength(0);
    expect(hit).toMatchObject({ id, matchedIn: 'title', snippet: null, matchedEventId: null, score: 1 });
    // Every word, in any order and any case, each anywhere in the title.
    expect(q.searchChatSessions({ query: 'REVIEW quarter' }).map((r) => r.id)).toEqual([id]);
    expect(q.searchChatSessions({ query: '"roadmap review"' }).map((r) => r.id)).toEqual([id]);
    expect(q.searchChatSessions({ query: 'roadmap budget' })).toHaveLength(0);
  });

  it("finds a tab by its chat's title, the execution's, but not by words split across the two", async () => {
    const q = await import('@/lib/db/queries');
    const agent = q.createWorkspace({ name: 'Charts', cwd: root, isGit: false, filesToCopy: [], status: 'active' });
    const execution = q.createExecution({ workspaceId: agent.id, label: 'Charting go-live data' });
    const tab = await seedSession({
      workspaceId: agent.id,
      executionId: execution.id,
      label: 'Adversarial review',
      events: [{ source: 'user', content: 'look this over' }],
    });
    const untitledTab = await seedSession({
      workspaceId: agent.id,
      executionId: execution.id,
      label: null,
      events: [{ source: 'user', content: 'and this' }],
    });

    expect(q.searchChatSessions({ query: 'go-live charting' }).map((r) => r.id).sort()).toEqual(
      [tab, untitledTab].sort(),
    );
    expect(q.searchChatSessions({ query: 'adversarial' }).map((r) => r.id)).toEqual([tab]);
    expect(q.searchChatSessions({ query: 'adversarial charting' })).toHaveLength(0);
  });

  it('lists title matches first, the exact title, then one that starts with it, then newest, then messages', async () => {
    const q = await import('@/lib/db/queries');
    const exact = await seedSession({
      label: 'Deploy pipeline',
      events: [{ source: 'agent', content: 'The deploy pipeline is green again.' }],
    });
    const prefix = await seedSession({ label: 'Deploy pipeline cleanup', events: [] });
    const containsOld = await seedSession({ label: 'Fix the deploy pipeline', events: [] });
    const containsNew = await seedSession({ label: 'Why the pipeline deploy failed', events: [] });
    const message = await seedSession({
      label: 'Morning check-in',
      events: [{ source: 'user', content: 'the deploy pipeline broke overnight' }],
    });
    // Newest last in rank order, so rank and not recency puts them there.
    await setActivity(exact, '2026-10-01T09:00:00.000Z');
    await setActivity(prefix, '2026-10-02T09:00:00.000Z');
    await setActivity(containsOld, '2026-10-03T09:00:00.000Z');
    await setActivity(containsNew, '2026-10-04T09:00:00.000Z');
    await setActivity(message, '2026-10-05T09:00:00.000Z');

    const results = q.searchChatSessions({ query: 'deploy pipeline' });
    expect(results.map((r) => r.id)).toEqual([exact, prefix, containsNew, containsOld, message]);
    expect(results.map((r) => r.matchedIn)).toEqual(['title', 'title', 'title', 'title', 'messages']);
    // A chat whose title and messages both match is listed once, with its passage.
    expect(results[0]!.snippet).toContain('deploy');
    expect(results[0]!.matchedEventId).toBeTruthy();
    expect(results[4]!.snippet).toContain('overnight');
    // Scores run down the list: titles at 1, messages below.
    expect(results.slice(0, 4).every((r) => r.score === 1)).toBe(true);
    expect(results[4]!.score).toBeGreaterThan(0);
    expect(results[4]!.score).toBeLessThan(1);
  });

  it('narrows title matches by status, agent and source, and counts them toward the limit', async () => {
    const q = await import('@/lib/db/queries');
    const agent = await seedAgent('Ri');
    const active = await seedSession({ label: 'Limitfacet one', workspaceId: agent, events: [] });
    const archived = await seedSession({ label: 'Limitfacet two', status: 'archived', events: [] });
    const imported = await seedSession({
      label: 'Limitfacet three',
      surfaceKind: 'imported_agent',
      surfaceRef: 'codex',
      events: [],
    });
    const message = await seedSession({ label: 'Other', events: [{ source: 'agent', content: 'limitfacet in a message' }] });
    await setActivity(active, '2026-10-03T09:00:00.000Z');
    await setActivity(archived, '2026-10-02T09:00:00.000Z');
    await setActivity(imported, '2026-10-01T09:00:00.000Z');

    expect(q.searchChatSessions({ query: 'limitfacet', status: 'archived' }).map((r) => r.id)).toEqual([archived]);
    expect(q.searchChatSessions({ query: 'limitfacet', workspaceId: agent }).map((r) => r.id)).toEqual([active]);
    expect(q.searchChatSessions({ query: 'limitfacet', source: 'imported' }).map((r) => r.id)).toEqual([imported]);
    expect(q.searchChatSessions({ query: 'limitfacet', source: 'native' }).map((r) => r.id)).toEqual([
      active,
      archived,
      message,
    ]);

    // A bigger limit only appends, so paging by limit keeps the rows it had.
    expect(q.searchChatSessions({ query: 'limitfacet', limit: 2 }).map((r) => r.id)).toEqual([active, archived]);
    expect(q.searchChatSessions({ query: 'limitfacet', limit: 4 }).map((r) => r.id)).toEqual([
      active,
      archived,
      imported,
      message,
    ]);
  });

  it("matches a title's % and _ as themselves, not as wildcards", async () => {
    const q = await import('@/lib/db/queries');
    const percent = await seedSession({ label: 'Roll out to 50% of users', events: [] });
    await seedSession({ label: 'Roll out to 500 users', events: [] });
    const underscore = await seedSession({ label: 'Rename user_id', events: [] });
    await seedSession({ label: 'Rename userxid', events: [] });

    expect(q.searchChatSessions({ query: '50%' }).map((r) => r.id)).toEqual([percent]);
    expect(q.searchChatSessions({ query: 'user_id' }).map((r) => r.id)).toEqual([underscore]);
  });

  it('says what matched over HTTP and to agents, with plain text and no passage for a title match', async () => {
    const titled = await seedSession({ label: 'Wireframes for onboarding', events: [] });
    const said = await seedSession({
      label: 'Standup',
      events: [{ source: 'user', content: 'send the wireframes to Dana' }],
    });

    const { NextRequest } = await import('next/server');
    const { GET } = await import('@/app/api/sessions/search/route');
    const response = await GET(new NextRequest('http://localhost/api/sessions/search?q=wireframes'));
    expect(response.status).toBe(200);
    expect(
      (await response.json() as Array<{ id: string; matchedIn: string; snippet: string | null }>).map((r) => [
        r.id,
        r.matchedIn,
        r.snippet === null,
      ]),
    ).toEqual([
      [titled, 'title', true],
      [said, 'messages', false],
    ]);

    const { runAction } = await import('@/lib/orchestrator/dispatch');
    const env = await runAction('search_sessions', { query: 'wireframes' }, { remote: false });
    expect(env.ok).toBe(true);
    expect(env.result).toEqual([
      expect.objectContaining({ sessionId: titled, label: 'Wireframes for onboarding', matchedIn: 'title', snippet: null, score: 1 }),
      expect.objectContaining({ sessionId: said, matchedIn: 'messages', snippet: expect.stringContaining('wireframes') }),
    ]);
    // Plain text for agents: the highlight sentinels are gone.
    const { CHAT_SEARCH_HL_START } = await import('@/lib/search/highlight');
    expect(JSON.stringify(env.result)).not.toContain(CHAT_SEARCH_HL_START);
  });
});
