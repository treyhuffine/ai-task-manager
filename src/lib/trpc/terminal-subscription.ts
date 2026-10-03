import { tracked, TRPCError } from '@trpc/server';
import { z } from 'zod/v4';
import { runTerminalFeed, isTerminalBase } from '@/lib/realtime/terminal-feed';
import { viewerProcedure, router } from './init';

const frameSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('ready'), data: z.object({ id: z.string(), resumed: z.boolean() }), id: z.string().optional() }),
  z.object({ event: z.literal('data'), data: z.string(), id: z.string().optional() }),
  z.object({ event: z.literal('exit'), data: z.object({ code: z.number().nullable(), signal: z.number().nullable(), gone: z.boolean().optional() }), id: z.string().optional() }),
  z.object({ event: z.literal('unavailable'), data: z.object({ message: z.string() }), id: z.string().optional() }),
  z.object({ event: z.literal('error'), data: z.object({ message: z.string() }), id: z.string().optional() }),
]);
export type TerminalFrame = z.infer<typeof frameSchema>;
export const terminalSubscriptionInput = z.object({
  base: z.string().refine(isTerminalBase), terminalId: z.string().min(1).max(128),
  after: z.number().int().nonnegative().nullable(), lastEventId: z.string().max(32).optional(),
}).strict();

/** The existing local/worker replay feed, with bounded subscriber buffering.
 * No HTTP request is made. A slow consumer reconnects against the PTY ring. */
export async function* terminalFrames(input: z.infer<typeof terminalSubscriptionInput>, signal?: AbortSignal) {
  const stop = new AbortController();
  const abort = () => stop.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) stop.abort();
  let cursor = input.lastEventId && /^\d+$/.test(input.lastEventId) ? Number(input.lastEventId) : input.after;
  let wake = () => {};
  const queue: TerminalFrame[] = [];
  let bytes = 0;
  let done = false;
  let failure: unknown;
  const ended = () => { done = true; wake(); };
  const feed = runTerminalFeed(input.base, input.terminalId, cursor, (event, data, id) => {
    const frame = frameSchema.parse({ event, data, id });
    bytes += Buffer.byteLength(JSON.stringify(frame));
    if (bytes > 512 * 1024 || queue.length >= 256) {
      failure = new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Terminal output is catching up. Reconnect to resume.' });
      stop.abort();
      ended();
      return;
    }
    queue.push(frame);
    wake();
  }, stop.signal).catch(error => { failure = error; }).finally(ended);
  const onAbort = () => { ended(); };
  stop.signal.addEventListener('abort', onAbort, { once: true });
  try {
    while (!signal?.aborted) {
      if (failure) throw failure;
      const frame = queue.shift();
      if (frame) {
        bytes -= Buffer.byteLength(JSON.stringify(frame));
        if (frame.event === 'ready' && !frame.data.resumed) cursor = null;
        if (frame.id !== undefined && /^\d+$/.test(frame.id)) cursor = Number(frame.id);
        yield tracked(cursor === null ? 'fresh' : String(cursor), frame);
      } else if (done) return;
      else await new Promise<void>(resolve => { wake = resolve; });
    }
  } finally {
    stop.abort();
    signal?.removeEventListener('abort', abort);
    stop.signal.removeEventListener('abort', onAbort);
    await feed;
  }
}

export const terminalSubscriptions = router({
  output: viewerProcedure.input(terminalSubscriptionInput).subscription(({ input, signal }) => terminalFrames(input, signal)),
});
