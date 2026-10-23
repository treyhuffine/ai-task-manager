import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { getRawDb } from '@/lib/db';
import * as q from './queries';

let home: TestHome;
beforeEach(async () => { home = await createTestHome({ prefix: 'ri-team-chat-cursor-' }); });
afterEach(async () => { await home.cleanup(); });

it('pages team transcripts by session and insertion position without sorting the whole chat', () => {
  const db = getRawDb();
  for (const [suffix, args] of [
    ['AND rowid > ? ORDER BY rowid LIMIT 200', ['chat', 1]],
    ['ORDER BY rowid DESC LIMIT 200', ['chat']],
    ['AND rowid < ? ORDER BY rowid DESC LIMIT 201', ['chat', 250]],
  ] as const) {
    const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM chat_events WHERE session_id = ? ${suffix}`).all(...args) as { detail: string }[];
    expect(plan.map(row => row.detail).join('\n')).not.toMatch(/TEMP B-TREE|SCAN chat_events/);
    expect(plan.map(row => row.detail).join('\n')).toContain('idx_chat_events_session_cursor');
  }
});

it('keeps a delivered cursor valid through VACUUM on the actual indexed schema', () => {
  const chat = q.createChatSession({ harness: 'claude', type: 'orchestration', surfaceKind: q.TEAM_CHAT_SURFACE, label: 'Cursor' });
  const first = q.insertChatEvent({ sessionId: chat.id, role: 'user', source: 'user', content: 'One' })!;
  q.insertChatEvent({ sessionId: chat.id, role: 'user', source: 'user', content: 'Two' });
  const before = q.listTeamChatEventsLatest(chat.id);
  getRawDb().prepare('DELETE FROM chat_events WHERE id = ?').run(first.id);
  getRawDb().exec('VACUUM');
  expect(q.listTeamChatEventsLatest(chat.id).cursor).toBe(before.cursor);
  const latest = q.insertChatEvent({ sessionId: chat.id, role: 'assistant', source: 'agent', content: 'Three' })!;
  expect(q.listTeamChatEventsAfter(chat.id, before.cursor).events.map(event => event.id)).toEqual([latest.id]);
});

it('looks up historical turn states through their message index', () => {
  const plan = getRawDb().prepare('EXPLAIN QUERY PLAN SELECT * FROM team_chat_turns WHERE chat_session_id = ? AND message_event_id IN (?, ?)')
    .all('chat', 'a', 'b') as { detail: string }[];
  expect(plan.map(row => row.detail).join('\n')).toContain('idx_team_chat_turns_message');
});

it('replays only newer requested parts from the same chat through primary-key probes', () => {
  const chat = q.createChatSession({ harness: 'claude', type: 'orchestration', surfaceKind: q.TEAM_CHAT_SURFACE, label: 'Streaming' });
  const other = q.createChatSession({ harness: 'claude', type: 'orchestration', surfaceKind: q.TEAM_CHAT_SURFACE, label: 'Other' });
  const part = q.replaceChatEventPart({ sessionId: chat.id, role: 'assistant', source: 'agent', content: 'First', externalEventId: 'stable-part', partRevision: 0 })!;
  const privatePart = q.replaceChatEventPart({ sessionId: other.id, role: 'assistant', source: 'agent', content: 'Other chat', externalEventId: 'stable-part', partRevision: 3 })!;
  const before = q.listTeamChatEventsLatest(chat.id).cursor;
  q.replaceChatEventPart({ sessionId: chat.id, role: 'assistant', source: 'agent', content: 'Completed text', externalEventId: 'stable-part', partRevision: 1 });
  expect(q.listTeamChatEventsAfter(chat.id, before).events).toEqual([]);
  expect(q.revisedTeamChatEvents(chat.id, [{ id: part.id, revision: 0 }, { id: privatePart.id, revision: 0 }])).toMatchObject([{ id: part.id, partRevision: 1, content: 'Completed text' }]);
  expect(q.revisedTeamChatEvents(chat.id, [{ id: part.id, revision: 1 }])).toEqual([]);
  const plan = getRawDb().prepare('EXPLAIN QUERY PLAN SELECT session_id, source, part_revision, rowid FROM chat_events WHERE id = ?').all(part.id) as { detail: string }[];
  expect(plan.map(row => row.detail).join('\n')).toContain('sqlite_autoindex_chat_events_1');
  expect(plan.map(row => row.detail).join('\n')).not.toMatch(/TEMP B-TREE|SCAN chat_events/);
});
