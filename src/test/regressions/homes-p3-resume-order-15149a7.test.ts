/** Cursor ordering is a server guarantee, not a property of independent clients' clocks. */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { openSessionFeed } from '@/lib/realtime/session-feed';
import type { ChatEventDTO } from '@/lib/api/dto/chat-event';

let home: TestHome;
let chat: string;
let q: typeof import('@/lib/db/queries');
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-resume-order-' });
  q = await import('@/lib/db/queries');
  chat = q.createChatSession({ type: 'orchestration', harness: 'claude' }).id;
});
afterEach(async () => { await home?.cleanup(); });

it('does not certify a complete resume that misses the reply after a client-minted future id', () => {
  // A phone clock only one minute ahead. The send route preserves its event id.
  const ms = (Date.now() + 60_000).toString(16).padStart(12, '0');
  const id = `${ms.slice(0, 8)}-${ms.slice(8)}-7000-8000-000000000000`;
  const first = q.insertChatEvent({ id, sessionId: chat, role: 'user', source: 'user', content: 'Question from phone', createdAt: new Date().toISOString() })!;
  // Its frame reached the page; the page disconnects before the reply is written.
  const reply = q.insertChatEvent({ sessionId: chat, role: 'assistant', source: 'text', content: 'The missing answer', createdAt: new Date().toISOString() })!;
  expect(reply.id < first.id).toBe(true);
  const events: ChatEventDTO[] = [];
  let resumed = false;
  const stop = openSessionFeed(chat, first.id, (event, data) => {
    if (event === 'chat_event') events.push(data as ChatEventDTO);
    if (event === 'ready') resumed = (data as { resumed: boolean }).resumed;
  }, { revisedSince: first.updatedAt });
  stop();
  expect(resumed && !events.some((event) => event.id === reply.id),
    'ready says fully resumed, suppressing the only snapshot that could recover the answer').toBe(false);
});
