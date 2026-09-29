/**
 * The page stream's subscription (P3 review, re-check): each chat carries
 * where it left off and the newest change it saw. A watermark in any other
 * shape is dropped, so the chat reads its transcript afresh, rather than
 * refusing the page its one stream.
 */

import { NextRequest } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';

const feeds = vi.hoisted(() => [] as Array<{ sessionId: string; after: string | null; options: unknown }>);
vi.mock('@/lib/realtime/session-feed', () => ({
  openSessionFeed: (sessionId: string, after: string | null, _emit: unknown, options: unknown) => {
    feeds.push({ sessionId, after, options });
    return () => {};
  },
}));

import { GET } from './route';

afterEach(() => {
  feeds.length = 0;
});

async function open(sub: unknown) {
  const response = await GET(new NextRequest(`http://home/api/live?sub=${encodeURIComponent(JSON.stringify(sub))}`));
  await response.body?.cancel();
  return response;
}

it('passes each chat where it left off and the newest change it saw', async () => {
  const response = await open({ s: [['chat-a', 'ev-1', '2026-09-28 10:00:00'], ['chat-b', null, null], ['chat-c', 'ev-2']], t: [] });
  expect(response.status).toBe(200);
  expect(feeds).toEqual([
    { sessionId: 'chat-a', after: 'ev-1', options: { revisedSince: '2026-09-28 10:00:00' } },
    { sessionId: 'chat-b', after: null, options: { revisedSince: null } },
    { sessionId: 'chat-c', after: 'ev-2', options: { revisedSince: null } },
  ]);
});

it('drops a watermark in any other shape, and still opens the stream', async () => {
  const response = await open({ s: [['chat-a', 'ev-1', '2026-09-28T10:00:00.000Z'], ['chat-b', 'ev-2', 42]], t: [] });
  expect(response.status).toBe(200);
  expect(feeds.map((f) => f.options)).toEqual([{ revisedSince: null }, { revisedSince: null }]);
});

it('refuses a subscription it cannot read', async () => {
  expect((await open({ s: [['../etc', null]], t: [] })).status).toBe(400);
  expect((await open({ s: [], t: [['/elsewhere', 't1', null]] })).status).toBe(400);
  expect(feeds).toEqual([]);
});
