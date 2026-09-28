/**
 * A chat's feed on resume (P3 re-check): all of what was missed, parts
 * revised in place included, or nothing and `resumed: false`, so the page
 * reads the transcript afresh. `ready` says where the transcript stands.
 */

import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import type { ChatEventDTO } from '@/lib/api/dto/chat-event';

let home: TestHome;
let chat: string;
let q: typeof import('@/lib/db/queries');

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-session-feed-' });
  q = await import('@/lib/db/queries');
  chat = q.createChatSession({ type: 'orchestration', harness: 'claude' }).id;
});
afterEach(async () => {
  await home?.cleanup();
});

async function open(after: string | null, revisedSince?: string | null) {
  const { openSessionFeed } = await import('./session-feed');
  const frames: Array<{ event: string; data: unknown }> = [];
  const stop = openSessionFeed(chat, after, (event, data) => frames.push({ event, data }), { revisedSince });
  stop();
  const events = frames.filter((f) => f.event === 'chat_event').map((f) => f.data as ChatEventDTO);
  const ready = frames.find((f) => f.event === 'ready')!.data as { resumed: boolean; position: { after: string | null; since: string | null } };
  return { events, ready };
}

const part = (content: string, partRevision: number) => ({
  sessionId: chat,
  role: 'assistant' as const,
  source: 'text',
  externalEventId: 'provider-part',
  content,
  partRevision,
  createdAt: new Date(1).toISOString(),
});

it('replays what was missed, and the parts revised in place since the newest change it saw', async () => {
  const first = q.replaceChatEventPart(part('Hello', 1))!;
  const seen = first.updatedAt;
  const next = q.insertChatEvent({ sessionId: chat, role: 'user', source: 'user', content: 'go on', createdAt: new Date(2).toISOString() })!;
  q.replaceChatEventPart(part('Hello, completed answer', 2));

  const { events, ready } = await open(next.id, seen);
  expect(ready.resumed).toBe(true);
  expect(events.map((e) => [e.id, e.content])).toEqual([[first.id, 'Hello, completed answer']]);
});

it('resumes without a watermark when nothing in the chat is ever revised in place', async () => {
  const first = q.insertChatEvent({ sessionId: chat, role: 'user', source: 'user', content: 'a', createdAt: new Date(1).toISOString() })!;
  const second = q.insertChatEvent({ sessionId: chat, role: 'assistant', source: 'text', content: 'b', createdAt: new Date(2).toISOString() })!;
  const { events, ready } = await open(first.id, null);
  expect(ready.resumed).toBe(true);
  expect(events.map((e) => e.id)).toEqual([second.id]);
});

it("replays nothing and says so when revised parts can't be found without a watermark", async () => {
  const first = q.replaceChatEventPart(part('Hello', 1))!;
  q.insertChatEvent({ sessionId: chat, role: 'user', source: 'user', content: 'go on', createdAt: new Date(2).toISOString() });
  const { events, ready } = await open(first.id, null);
  expect(ready.resumed).toBe(false);
  expect(events).toEqual([]);
});

it('replays nothing and says so when more was missed than one replay holds', async () => {
  const first = q.insertChatEvent({ sessionId: chat, role: 'user', source: 'user', content: 'start', createdAt: new Date(0).toISOString() })!;
  for (let i = 1; i <= 1001; i++) {
    q.insertChatEvent({ sessionId: chat, role: 'assistant', source: 'text', content: String(i), createdAt: new Date(i).toISOString() });
  }
  const { events, ready } = await open(first.id, '2000-01-01 00:00:00');
  expect(ready.resumed).toBe(false);
  expect(events).toEqual([]);
});

it('says where the transcript stands: the event written last, not the greatest id', async () => {
  // A message keeps the id its sender minted, on its sender's clock: one
  // from a clock running ahead has a greater id than what follows it.
  const ahead = q.insertChatEvent({ id: '01ffffff-ffff-7fff-bfff-ffffffffffff', sessionId: chat, role: 'user', source: 'user', content: 'from a fast clock', createdAt: new Date(1).toISOString() })!;
  const last = q.insertChatEvent({ sessionId: chat, role: 'assistant', source: 'text', content: 'reply', createdAt: new Date(2).toISOString() })!;
  expect(ahead.id > last.id).toBe(true);
  const { ready } = await open(null);
  expect(ready.resumed).toBe(false);
  expect(ready.position.after).toBe(last.id);
  expect(ready.position.since).toBe(last.updatedAt);
});
