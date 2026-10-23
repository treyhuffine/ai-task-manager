import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';
import * as q from '@/lib/db/queries';
import { authorizeTeamExecution } from '@/lib/home/execution-authority';
import { withExecutionRequest } from '@/lib/home/execution-request';
import { openPageFeed, type PageFrame } from '@/lib/realtime/page-feed';
import { isTerminalBase, terminalPlaceForBase } from '@/lib/realtime/terminal-feed';
import { perfScope } from '@/lib/perf/recorder';
import { sharedProcedure, router, type TRPCContext } from './init';
import { chatEventProjector } from '@/lib/team/chat-event-view';

const id = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
export const pageSubscriptionInput = z.object({
  s: z.array(z.tuple([id, id.nullable(), z.string().max(32).nullable().transform(value => value && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value : null)])).max(32),
  t: z.array(z.tuple([z.string().refine(isTerminalBase), id, z.number().int().nonnegative().nullable()])).max(32),
}).strict().refine(input => input.s.length + input.t.length <= 32);

/** The ordinary feed with live viewing authority and bounded socket buffering. */
export async function* pageFrames(input: z.infer<typeof pageSubscriptionInput>, viewer: Pick<TRPCContext, 'key' | 'authorize'>, signal?: AbortSignal) {
  const team = q.getHome()?.kind === 'team';
  const inViewer = <T>(work: () => T) => viewer.key ? withExecutionRequest(viewer.key, work) : work();
  const sessionAllowed = (chatId: string) => {
    if (!team) return true;
    try { authorizeTeamExecution(viewer.key, { chatId, operation: 'read' }); return true; }
    catch (error) { if (!q.isTeamError(error)) throw error; return false; }
  };
  const admit = () => {
    viewer.authorize?.();
    if (!viewer.key) throw new TRPCError({ code: 'UNAUTHORIZED' });
    if (team) {
      try { authorizeTeamExecution(viewer.key, { operation: 'readCatalog' }); }
      catch (error) { if (!q.isTeamError(error)) throw error; throw new TRPCError({ code: 'FORBIDDEN', message: error.message }); }
      if (input.s.some(([chatId]) => !sessionAllowed(chatId))) throw new TRPCError({ code: 'FORBIDDEN', message: 'This page can follow only authorized shared chats.' });
    } else if (viewer.key.scope !== 'viewer') throw new TRPCError({ code: 'FORBIDDEN' });
    for (const [base] of input.t) {
      const place = inViewer(() => terminalPlaceForBase(base));
      if (!place || place.at === 'nowhere') throw new TRPCError({ code: 'FORBIDDEN', message: place?.error ?? 'This terminal is unavailable.' });
    }
  };
  admit();
  const projectors = new Map(input.s.map(([chatId]) => [chatId, chatEventProjector(team ? q.getChatSession(chatId) : null)]));
  if (signal?.aborted) return;
  const stop = new AbortController();
  const abort = () => stop.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let wake = () => {};
  let unsubscribe = () => {};
  let failure: unknown;
  let bytes = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const queue: PageFrame[] = [];
  const end = () => { if (timer) clearInterval(timer); unsubscribe(); wake(); };
  stop.signal.addEventListener('abort', end, { once: true });
  const emit = (event: string, data: unknown) => {
    if (stop.signal.aborted) return;
    try {
      admit();
      const frame = { event, data };
      bytes += Buffer.byteLength(JSON.stringify(frame));
      if (bytes > 8 * 1024 * 1024 || queue.length >= 512) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'This page is catching up. Reconnect to resume.' });
      queue.push(frame); wake();
    } catch (error) { failure = error; stop.abort(); }
  };
  timer = setInterval(() => perfScope('timer:page-viewer-authority', () => {
    try { admit(); } catch (error) { failure = error; stop.abort(); }
  }), 1_000);
  timer.unref();
  try {
    unsubscribe = inViewer(() => openPageFeed(input, emit, {
      signal: stop.signal, sessionAllowed,
      projectSessionEvent: (chatId, event) => projectors.get(chatId)!(event),
      globalAllowed: message => !team || (message.kind === 'session_updated' ? sessionAllowed(message.sessionId) : message.kind === 'device_updated' && message.deviceId === q.getHome()?.hostDeviceId),
    }));
    if (stop.signal.aborted) unsubscribe();
    while (!signal?.aborted) {
      if (failure) throw failure;
      const frame = queue.shift();
      if (frame) { admit(); bytes -= Buffer.byteLength(JSON.stringify(frame)); yield frame; }
      else if (stop.signal.aborted) return;
      else await new Promise<void>(resolve => { wake = resolve; });
    }
  } finally {
    if (timer) clearInterval(timer); stop.abort(); unsubscribe();
    stop.signal.removeEventListener('abort', end);
    signal?.removeEventListener('abort', abort);
  }
}

export const pageSubscriptions = router({
  output: sharedProcedure.input(pageSubscriptionInput).subscription(({ input, ctx, signal }) => pageFrames(input, ctx, signal)),
});
