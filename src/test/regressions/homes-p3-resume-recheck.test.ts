/**
 * Actual feed + transcript cache, with only React mounting and HTTP mocked.
 *
 * P3 re-check at d0c788f, finding 3: a resume capped at 1,000 events, or
 * missing a part revised in place, still said `resumed`, so the transcript
 * was never refetched. The first two are the review's probes (the refetch
 * path); the third was added at the fix (the precise path).
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver, type QueryObserverOptions } from '@tanstack/react-query';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { toChatEventDTO, toChatEventDTOs, type ChatEventDTO } from '@/lib/api/dto/chat-event';

const state = vi.hoisted(() => ({
  options: null as unknown, client: null as unknown,
  receiver: null as null | ((event: string, data: unknown) => void),
  cleanup: [] as Array<() => void>,
}));
vi.mock('@tanstack/react-query', async (original) => ({
  ...await original<typeof import('@tanstack/react-query')>(),
  useQuery: (options: unknown) => { state.options = options; return {}; },
  useQueryClient: () => state.client,
}));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useEffect: (fn: () => void | (() => void)) => { const cleanup = fn(); if (cleanup) state.cleanup.push(cleanup); },
}));
vi.mock('@/lib/realtime/page-stream', () => ({ pageStream: () => ({
  subscribeSession: (_id: string, receiver: (event: string, data: unknown) => void) => {
    state.receiver = receiver; return () => { state.receiver = null; };
  },
}) }));
import { sessionsApi } from '@/lib/api/sessions';
import { useSessionEvents } from '@/hooks/use-execution';
import { useSessionStream } from '@/hooks/use-session-stream';
import { openSessionFeed } from '@/lib/realtime/session-feed';

let home: TestHome;
let chat: string;
let client: QueryClient;
const key = () => ['session', chat, 'events'];
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-p3-resume-recheck-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache(); identity.ensureHomeIdentity();
  const q = await import('@/lib/db/queries');
  chat = q.createChatSession({ type: 'orchestration', harness: 'claude' }).id;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  state.client = client;
  vi.spyOn(sessionsApi, 'events').mockImplementation(async (id, opts) => toChatEventDTOs(q.listChatEvents(id, opts)));
  useSessionEvents(chat);
  useSessionStream(chat);
});
afterEach(async () => {
  state.cleanup.splice(0).forEach((cleanup) => cleanup());
  client?.clear(); vi.restoreAllMocks();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home?.cleanup();
});
function observe() {
  const observer = new QueryObserver(client, { ...state.options as QueryObserverOptions, refetchOnMount: false });
  state.cleanup.push(observer.subscribe(() => {}));
}

it('recovers the latest result when more than 1000 events arrive during a disconnect', async () => {
  const q = await import('@/lib/db/queries');
  const first = q.insertChatEvent({ sessionId: chat, role: 'user', source: 'user', content: 'start', createdAt: new Date(0).toISOString() })!;
  client.setQueryData(key(), [toChatEventDTO(first)]);
  observe();
  let last = first;
  for (let i = 1; i <= 1001; i++) {
    last = q.insertChatEvent({ sessionId: chat, role: 'assistant', source: i === 1001 ? 'result' : 'text', content: i === 1001 ? 'Finished' : String(i), createdAt: new Date(i).toISOString() })!;
  }
  state.cleanup.push(openSessionFeed(chat, first.id, (event, data) => state.receiver!(event, data)));
  // Let any authoritative refetch on ready finish, using the real transcript query options.
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(client.getQueryData<ChatEventDTO[]>(key())!.some((event) => event.id === last.id),
    'resume stopped at 1000 rows and never fetched the final result').toBe(true);
});

it('refreshes a cumulative provider part revised while the stream was disconnected', async () => {
  const q = await import('@/lib/db/queries');
  const input = { sessionId: chat, role: 'assistant' as const, source: 'text', externalEventId: 'provider-part', content: 'Hello', partRevision: 1, createdAt: new Date(0).toISOString() };
  const first = q.replaceChatEventPart(input)!;
  client.setQueryData(key(), [toChatEventDTO(first)]);
  observe();
  q.replaceChatEventPart({ ...input, content: 'Hello, completed answer', partRevision: 2 });
  state.cleanup.push(openSessionFeed(chat, first.id, (event, data) => state.receiver!(event, data)));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(client.getQueryData<ChatEventDTO[]>(key())![0]!.content).toBe('Hello, completed answer');
});

it('takes a revised part from the stream, live and on a complete resume, with no refetch', async () => {
  const q = await import('@/lib/db/queries');
  const input = { sessionId: chat, role: 'assistant' as const, source: 'text', externalEventId: 'provider-part', content: 'Hello', partRevision: 1, createdAt: new Date(0).toISOString() };
  const first = q.replaceChatEventPart(input)!;
  client.setQueryData(key(), [toChatEventDTO(first)]);
  observe();
  const fetches = vi.mocked(sessionsApi.events).mock.calls.length;
  const emit = (event: string, data: unknown) => state.receiver!(event, data);

  // Live: the part grows while the chat is followed.
  const stop = openSessionFeed(chat, first.id, emit, { revisedSince: first.updatedAt });
  q.replaceChatEventPart({ ...input, content: 'Hello, wor', partRevision: 2 });
  expect(client.getQueryData<ChatEventDTO[]>(key())![0]!.content).toBe('Hello, wor');
  // An older revision arriving late changes nothing.
  state.receiver!('chat_event', toChatEventDTO({ ...first, content: 'Hel', partRevision: 1 }));
  expect(client.getQueryData<ChatEventDTO[]>(key())![0]!.content).toBe('Hello, wor');
  stop();

  // Away, then back: the revision made meanwhile is replayed.
  q.replaceChatEventPart({ ...input, content: 'Hello, world.', partRevision: 3 });
  state.cleanup.push(openSessionFeed(chat, first.id, emit, { revisedSince: first.updatedAt }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(client.getQueryData<ChatEventDTO[]>(key())!.map((e) => e.content)).toEqual(['Hello, world.']);
  expect(vi.mocked(sessionsApi.events).mock.calls.length).toBe(fetches);
});
