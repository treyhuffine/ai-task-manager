/**
 * In-process pub/sub for session-scoped realtime fan-out.
 *
 * The executor, queries.ts, and any route handler that mutates a chat
 * session's timeline publishes here; SSE endpoints subscribe. One Node
 * process, one bus — Next.js's executor and API routes share memory, so
 * no Redis / NOTIFY / cross-process plumbing is needed at this scale.
 *
 * State lives on `globalThis` under a Symbol key so it survives Next.js
 * HMR reloads in dev (same pattern as `executor/adapter.ts`'s session
 * cache). Subscribers added before a reload would otherwise leak; this
 * way the second instance reuses the live set.
 *
 * Channels are strings. Per-session channels use `session:<id>`; future
 * cross-cutting channels will namespace similarly. No globbing.
 */
import type { ChatEventRecord } from '@/db/types';
import type { PendingInput } from '@/lib/executor/pending-input';

/**
 * Lightweight cross-session signal for rail-facing state. The detailed
 * payload stays on the per-session channel. Dashboard listeners only need to
 * know that their authoritative rail snapshot is stale.
 */
export type GlobalSessionStreamMessage = {
  kind: 'session_updated';
  sessionId: string;
  reason: 'outcome' | 'runtime' | 'background_task' | 'pending_input' | 'reconcile';
};

/** Payload variants carried by the in-process realtime bus. */
export type SessionStreamMessage =
  | { kind: 'chat_event'; event: ChatEventRecord }
  | { kind: 'runtime'; running: boolean }
  | { kind: 'background_tasks'; active: boolean; taskIds: string[] }
  | { kind: 'pending_input'; pending: PendingInput[] }
  /**
   * Reconcile lifecycle. Server-side replay of Claude's on-disk JSONL
   * runs in the background; `started` lets the UI show a "Syncing…"
   * affordance, `done` clears it. The replay itself emits regular
   * `chat_event` frames as rows land — this variant just brackets them.
   */
  | { kind: 'reconcile'; status: 'started' | 'done'; replayed?: number }
  | GlobalSessionStreamMessage;

type Listener = (message: SessionStreamMessage) => void;

interface BusState {
  channels: Map<string, Set<Listener>>;
}

const STATE_KEY = Symbol.for('@flow/realtime-bus-state');
const globalRef = globalThis as unknown as { [STATE_KEY]?: BusState };

if (!globalRef[STATE_KEY]) {
  globalRef[STATE_KEY] = { channels: new Map() };
}

const state = globalRef[STATE_KEY]!;

export function publish(channel: string, message: SessionStreamMessage): void {
  const listeners = state.channels.get(channel);
  if (!listeners || listeners.size === 0) return;
  for (const listener of listeners) {
    try {
      listener(message);
    } catch (err) {
      console.error(`[realtime-bus] listener threw on channel ${channel}:`, err);
    }
  }
}

export function subscribe(channel: string, listener: Listener): () => void {
  let listeners = state.channels.get(channel);
  if (!listeners) {
    listeners = new Set();
    state.channels.set(channel, listeners);
  }
  listeners.add(listener);
  return () => {
    const set = state.channels.get(channel);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) state.channels.delete(channel);
  };
}

/** Channel name for a specific chat session's stream. */
export function sessionChannel(sessionId: string): string {
  return `session:${sessionId}`;
}

/** Dashboard-wide lifecycle channel used to refresh background sessions. */
export const globalSessionChannel = 'sessions:all';

function publishGlobal(message: GlobalSessionStreamMessage): void {
  publish(globalSessionChannel, message);
}

/**
 * Convenience helper. Used by the queries.ts insert path and the
 * messages route's direct user-event write. Keeping the channel
 * derivation here means callers don't have to remember the prefix.
 */
export function publishChatEvent(event: ChatEventRecord): void {
  publish(sessionChannel(event.sessionId), { kind: 'chat_event', event });
  // Root results and detached background outcomes are durable review boundaries.
  // Agent/tool activity can be very frequent, and runtime edges already cover
  // live bucket changes.
  if (event.source === 'result' || event.source === 'background_task') {
    publishGlobal({ kind: 'session_updated', sessionId: event.sessionId, reason: 'outcome' });
  }
}

export function publishRuntime(sessionId: string, running: boolean): void {
  publish(sessionChannel(sessionId), { kind: 'runtime', running });
  publishGlobal({ kind: 'session_updated', sessionId, reason: 'runtime' });
}

/** Publish the authoritative per-session background state and refresh the rail. */
export function publishBackgroundTaskActivity(
  sessionId: string,
  active: boolean,
  taskIds: string[],
): void {
  publish(sessionChannel(sessionId), { kind: 'background_tasks', active, taskIds });
  publishGlobal({ kind: 'session_updated', sessionId, reason: 'background_task' });
}

export function publishPendingInput(sessionId: string, pending: PendingInput[]): void {
  publish(sessionChannel(sessionId), { kind: 'pending_input', pending });
  publishGlobal({ kind: 'session_updated', sessionId, reason: 'pending_input' });
}

export function publishReconcileStarted(sessionId: string): void {
  publish(sessionChannel(sessionId), { kind: 'reconcile', status: 'started' });
}

export function publishReconcileDone(sessionId: string, replayed: number): void {
  publish(sessionChannel(sessionId), { kind: 'reconcile', status: 'done', replayed });
  if (replayed > 0) {
    publishGlobal({ kind: 'session_updated', sessionId, reason: 'reconcile' });
  }
}
