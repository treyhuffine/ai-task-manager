import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import * as q from '@/lib/db/queries';
import { chatEventProjector } from './chat-event-view';
import { compareTranscriptEvents } from '@/lib/api/dto/chat-event';
import { getRawDb, initDatabase } from '@/lib/db';
import path from 'node:path';
import { bindLegacyTeamChat } from '@/lib/db/team-chat-cutover';
let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
beforeEach(async () => { fixture = await createTeamExecutionFixture(); });
afterEach(async () => { await fixture.cleanup(); });
it('preserves legacy insertion order through agent binding, pagination, snapshots and live merges despite skewed timestamps', () => {
  const chat = q.createChatSession({ type: 'orchestration', harness: 'claude', surfaceKind: q.TEAM_CHAT_SURFACE });
  const events = [
    q.insertChatEvent({ sessionId: chat.id, role: 'user', source: 'user', content: 'First', createdAt: '2026-10-20T12:00:02Z' })!,
    q.insertChatEvent({ sessionId: chat.id, role: 'assistant', source: 'agent', content: 'Second', createdAt: '2026-10-20T12:00:01Z' })!,
    q.insertChatEvent({ sessionId: chat.id, role: 'user', source: 'user', content: 'Third', createdAt: '2026-10-20T12:00:00Z' })!,
  ];
  const ids = events.map(event => event.id);
  expect(q.listChatEvents(chat.id).map(event => event.id)).toEqual(ids);
  const plan = getRawDb().prepare('EXPLAIN QUERY PLAN SELECT rowid FROM chat_events INDEXED BY idx_chat_events_session_cursor WHERE session_id = ? ORDER BY rowid DESC LIMIT 200').all(chat.id) as { detail:string }[];
  expect(plan.some(row=>row.detail.includes('idx_chat_events_session_cursor'))).toBe(true);
  expect(plan.some(row=>row.detail.includes('TEMP B-TREE') || /^SCAN chat_events/.test(row.detail))).toBe(false);
  bindLegacyTeamChat({ chatId: chat.id, workspaceId: fixture.workspace.id, apiKeyId: fixture.owner.key.id, selection: { harness: 'claude', model: 'sonnet', modelVariant: null, effort: null, permissionMode: 'ask', prePlanMode: null } });
  expect(q.getChatSession(chat.id)?.createdByMemberId).toBeNull();
  const project = chatEventProjector(q.getChatSession(chat.id));
  const page = q.listChatEvents(chat.id, { limit: 2 }).map(event => project(event)!);
  expect(page.map(event => event.id)).toEqual(ids.slice(1));
  const older = q.listChatEvents(chat.id, { before: page[0].id, limit: 2 }).map(event => project(event)!);
  expect(older.map(event => event.id)).toEqual(ids.slice(0,1));
  const live = q.insertChatEvent({ sessionId: chat.id, role: 'assistant', source: 'agent', content: 'Live after binding', createdAt: '2026-10-19T00:00:00Z' })!;
  expect([...page, project(live)!, ...older].sort(compareTranscriptEvents).map(event => event.id)).toEqual([...ids, live.id]);
  expect(q.listTeamChatEventsLatest(chat.id).events.map(event => event.id)).toEqual([...ids, live.id]);
});

it('does not turn legacy boot or binding into recent chat activity', () => {
  const chat = q.createChatSession({ type: 'orchestration', harness: 'claude', surfaceKind: q.TEAM_CHAT_SURFACE });
  const at = '2026-01-01T00:00:00.000Z';
  q.updateChatSession(chat.id, { lastActivityAt: at });
  for (let boot = 0; boot < 2; boot++) {
    initDatabase(getRawDb(), path.resolve('drizzle'));
    expect(q.getChatSession(chat.id)?.lastActivityAt).toBe(at);
  }
  bindLegacyTeamChat({ chatId: chat.id, workspaceId: fixture.workspace.id, apiKeyId: fixture.owner.key.id, selection: { harness: 'claude', model: 'sonnet', modelVariant: null, effort: null, permissionMode: 'ask', prePlanMode: null } });
  expect(q.getChatSession(chat.id)?.lastActivityAt).toBe(at);
});
