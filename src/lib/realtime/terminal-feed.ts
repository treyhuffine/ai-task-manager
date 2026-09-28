/**
 * A terminal's output as part of the page stream (P3 review). It reads the
 * terminal's own stream, where the terminal is (`terminalStreamAt`: a shell
 * here, or relayed from the computer it runs on), and passes its frames on.
 * When that stream ends without the shell ending (its computer dropped, or
 * the relay fell out of step), it opens it again from the last offset it
 * passed on, after the delay the stream asked for. So the page's one
 * connection never has to reconnect for one terminal.
 */

import { agentTerminalPlace, sessionTerminalPlace, terminalStreamAt } from '@/lib/terminal/place';
import type { FeedEmit } from './session-feed';

/** `/sessions/<id>` or `/workspaces/<id>`: whose shell it is, as the terminal routes name it. */
const BASE = /^\/(sessions|workspaces)\/([A-Za-z0-9-]{1,64})$/;

export function isTerminalBase(base: string): boolean {
  return BASE.test(base);
}

const DEFAULT_RETRY_MS = 2_000;

export async function runTerminalFeed(
  base: string,
  terminalId: string,
  after: number | null,
  emit: FeedEmit,
  signal: AbortSignal,
): Promise<void> {
  const match = BASE.exec(base);
  if (!match) {
    emit('error', { message: 'Not a terminal' });
    return;
  }
  const [, kind, ownerId] = match;
  const place = () => (kind === 'sessions' ? sessionTerminalPlace(ownerId!) : agentTerminalPlace(ownerId!));
  let cursor = after;
  const decoder = new TextDecoder();

  while (!signal.aborted) {
    const headers = new Headers();
    if (cursor !== null) headers.set('last-event-id', String(cursor));
    const response = terminalStreamAt(new Request('http://page-stream.internal/', { headers }), place, terminalId);
    const reader = response.body!.getReader();
    const stop = () => void reader.cancel().catch(() => {});
    signal.addEventListener('abort', stop, { once: true });
    let ended = false;
    let retryMs = DEFAULT_RETRY_MS;
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let split: number;
        while ((split = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          let event = 'message';
          let data = '';
          let id: string | undefined;
          for (const line of frame.split('\n')) {
            if (line.startsWith(':')) continue;
            const colon = line.indexOf(':');
            const field = colon < 0 ? line : line.slice(0, colon);
            const text = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
            if (field === 'event') event = text;
            else if (field === 'data') data = data ? `${data}\n${text}` : text;
            else if (field === 'id') id = text;
            else if (field === 'retry' && /^\d+$/.test(text)) retryMs = Number(text);
          }
          if (!data) continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }
          if (id !== undefined && /^\d+$/.test(id)) cursor = Number(id);
          emit(event, parsed, id);
          // The shell ended, or isn't there: nothing more will come.
          if (event === 'exit' || event === 'error') ended = true;
        }
      }
    } catch {
      // Cancelled, or the stream failed: treated as ended below.
    } finally {
      signal.removeEventListener('abort', stop);
    }
    if (ended || signal.aborted) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, retryMs);
      signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }
}
