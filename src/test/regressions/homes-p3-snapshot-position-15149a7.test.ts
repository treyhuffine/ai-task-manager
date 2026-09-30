/** Real PageStream + feed + query cache: a ready position is not proof that its snapshot arrived. */
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver, type QueryObserverOptions } from '@tanstack/react-query';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { toChatEventDTOs, type ChatEventDTO } from '@/lib/api/dto/chat-event';

const state = vi.hoisted(() => ({ client: null as unknown, options: null as unknown, stream: null as unknown, cleanup: [] as Array<() => void> }));
vi.mock('@tanstack/react-query', async (original) => ({
  ...await original<typeof import('@tanstack/react-query')>(),
  useQuery: (options: unknown) => { state.options = options; return {}; },
  useQueryClient: () => state.client,
}));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useEffect: (fn: () => void | (() => void)) => { const cleanup = fn(); if (cleanup) state.cleanup.push(cleanup); },
}));
vi.mock('@/lib/realtime/page-stream', async (original) => ({
  ...await original<typeof import('@/lib/realtime/page-stream')>(),
  pageStream: () => state.stream,
}));
import { PageStream } from '@/lib/realtime/page-stream';
import { openSessionFeed } from '@/lib/realtime/session-feed';
import { sessionsApi } from '@/lib/api/sessions';
import { useSessionEvents } from '@/hooks/use-execution';
import { useSessionStream } from '@/hooks/use-session-stream';

class Source extends EventTarget {
  onerror: (() => void) | null = null;
  constructor(readonly url: string) { super(); }
  close() {}
  frame(session: string, event: string, data: unknown, id?: string) {
    const e = new Event('session') as Event & {data: string};
    e.data = JSON.stringify({s: session, e: event, d: data, i: id}); this.dispatchEvent(e);
  }
}
let home: TestHome;
afterEach(async () => {
  state.cleanup.splice(0).forEach((cleanup) => cleanup());
  (state.client as QueryClient)?.clear();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
  await home?.cleanup();
});

it('does not skip an event on reconnect after ready overtakes an older in-flight snapshot', async () => {
  home = await createTestHome({ prefix: 'ri-snapshot-position-' });
  const q = await import('@/lib/db/queries');
  const chat = q.createChatSession({type:'orchestration', harness:'claude'}).id;
  q.insertChatEvent({sessionId:chat, role:'user', source:'user', content:'A', createdAt:new Date().toISOString()});
  const client = new QueryClient({defaultOptions:{queries:{retry:false}}}); state.client = client;
  const sources: Source[] = [];
  state.stream = new PageStream({open:(url)=>{
    const source = new Source(url); sources.push(source); return source as unknown as EventSource;
  }});
  const oldSnapshot = toChatEventDTOs(q.listChatEvents(chat));
  let respond!: (value: ChatEventDTO[]) => void;
  vi.spyOn(sessionsApi,'events').mockImplementationOnce(()=>new Promise((resolve)=>{respond=resolve;}))
    .mockImplementation(async(id,opts)=>toChatEventDTOs(q.listChatEvents(id,opts)));
  vi.useFakeTimers();
  useSessionEvents(chat);
  const observer = new QueryObserver(client,state.options as QueryObserverOptions);
  state.cleanup.push(observer.subscribe(()=>{}));
  expect(respond).toBeTypeOf('function');
  useSessionStream(chat);
  // HTTP read A; B is written before the first live subscription is opened.
  const b = q.insertChatEvent({sessionId:chat, role:'assistant', source:'text', content:'B', createdAt:new Date().toISOString()})!;
  await vi.advanceTimersByTimeAsync(20);
  const first = sources[0]!;
  const stop = openSessionFeed(chat,null,(event,data,id)=>first.frame(chat,event,data,id));
  // The initial query is still in flight and has no data, so invalidation joins it.
  respond(oldSnapshot);
  await vi.advanceTimersByTimeAsync(10);
  stop(); first.onerror!();
  await vi.advanceTimersByTimeAsync(1000);
  const next = sources.at(-1)!;
  const [session,after,since] = JSON.parse(new URL(next.url,'http://test').searchParams.get('sub')!).s[0] as [string,string,string];
  state.cleanup.push(openSessionFeed(session,after,(event,data,id)=>next.frame(session,event,data,id),{revisedSince:since}));
  await vi.advanceTimersByTimeAsync(10);
  expect(client.getQueryData<ChatEventDTO[]>(['session',chat,'events'])!.some((event)=>event.id===b.id),
    'B was acknowledged by ready, but never reached the cache or its snapshot').toBe(true);
});
