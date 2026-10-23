/** The common multiplexed page feed, independent of its SSE or WebSocket adapter. */
import { globalSessionChannel, subscribe, type GlobalSessionStreamMessage } from './bus';
import { openSessionFeed } from './session-feed';
import { runTerminalFeed } from './terminal-feed';
import type { ChatEventRecord } from '@/db/types';
import type { ChatEventDTO } from '@/lib/api/dto/chat-event';

export interface PageSubscription {
  s: Array<[string, string | null, string | null]>;
  t: Array<[string, string, number | null]>;
}
export interface PageFrame { event: string; data: unknown }

export function openPageFeed(subscription: PageSubscription, emit: (event: string, data: unknown) => void, options: {
  signal: AbortSignal;
  sessionAllowed?: (id: string) => boolean;
  globalAllowed?: (message: GlobalSessionStreamMessage) => boolean;
  projectSessionEvent?: (sessionId: string, event: ChatEventRecord) => ChatEventDTO | null;
}): () => void {
  const stops: Array<() => void> = [];
  try {
    stops.push(subscribe(globalSessionChannel, message => {
      if ((message.kind === 'device_updated' || message.kind === 'session_updated') && (!options.globalAllowed || options.globalAllowed(message))) emit(message.kind, message);
    }));
    for (const [id, after, since] of subscription.s) {
      if (options.sessionAllowed && !options.sessionAllowed(id)) continue;
      stops.push(openSessionFeed(id, after, (event, data, cursor) => {
        if (!options.sessionAllowed || options.sessionAllowed(id)) emit('session', { s: id, e: event, d: data, i: cursor });
      }, { revisedSince: since, ...(options.projectSessionEvent ? { projectEvent: event => options.projectSessionEvent!(id, event) } : {}) }));
    }
    for (const [base, terminalId, after] of subscription.t) {
      const key = `${base}:${terminalId}`;
      void runTerminalFeed(base, terminalId, after, (event, data, id) => emit('terminal', { k: key, e: event, d: data, i: id }), options.signal).catch(error => {
        if (!options.signal.aborted) emit('terminal', { k: key, e: 'error', d: { message: error instanceof Error ? error.message : 'Terminal unavailable.' } });
      });
    }
    emit('ready', {});
    return () => { for (const stop of stops) stop(); };
  } catch (error) { for (const stop of stops) stop(); throw error; }
}
