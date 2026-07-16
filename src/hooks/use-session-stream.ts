'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ChatEventRecord } from '@/db/types';
import type { PendingInput } from '@/lib/api/sessions';
import { isMutatingToolUse } from '@/lib/executor/mutation-detect';
import { worktreeScopeFromCache } from '@/hooks/use-execution';
import { hot } from '@/lib/_debug/hot-path';
import {
  withBackgroundTaskStatus,
  withRunningStatus,
  type SessionRuntimeStatus,
} from '@/lib/executor/runtime-status';

/**
 * Subscribes to the per-session SSE stream and folds every frame into
 * the matching TanStack Query cache:
 *
 *   - `chat_event`   → appends-with-dedup into `['session', id, 'events']`
 *   - `runtime`      → replaces `['session', id, 'runtime-status']`
 *   - `background_tasks` → updates the detached-work axis of runtime status
 *   - `pending_input`→ replaces `['session', id, 'pending-input']`
 *
 * Replaces the three independent polls (3s/2s/1.5s) those caches used
 * to drive. Snapshot fetches still fire on mount + window focus as a
 * fallback if the stream is unavailable; on a healthy stream they're
 * superfluous but harmless (dedup-by-id keeps overlap correct).
 *
 * EventSource auto-reconnects on disconnect with the native
 * `Last-Event-ID` header populated from the last `id:` we emitted (set
 * on `chat_event` frames; runtime/pending have no id since they're
 * last-write-wins and replayed in full on every connect). Server
 * replays missed chat_event rows via `listChatEventsAfter`, so
 * laptop-sleep / network-blip recovery is automatic and lossless.
 *
 * Cookie auth carries the session; EventSource can't attach headers
 * but cookies flow natively and `proxy.ts` accepts either Bearer or
 * cookie. No client-side auth wiring needed.
 */
export function useSessionStream(sessionId: string | null): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!sessionId) return;

    const source = new EventSource(`/api/sessions/${sessionId}/stream`);
    const eventsKey = ['session', sessionId, 'events'] as const;
    const runtimeKey = ['session', sessionId, 'runtime-status'] as const;
    const pendingKey = ['session', sessionId, 'pending-input'] as const;
    const reconcilingKey = ['session', sessionId, 'reconciling'] as const;
    // Tier-1 tree refresh. Resolved at fire time rather than closed over,
    // because the tree is cached per *execution* and the scope depends on
    // the session row being in cache — which it is by the time any frame
    // arrives, but isn't guaranteed when this effect first runs.
    const treeKey = () => [...worktreeScopeFromCache(queryClient, sessionId), 'tree'] as const;

    // Any state change for this session that the rail cares about —
    // turn finished, runtime flipped, pending request changed — is a
    // signal to re-fetch the rail. Cheaper than a global SSE channel
    // and snaps the rail's buckets to reality as soon as the viewed
    // session moves between them.
    const invalidateRail = () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', 'rail'] });
      queryClient.invalidateQueries({ queryKey: ['sessions', 'needs-review'] });
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    };

    const handleChatEvent = (raw: MessageEvent) => {
      hot('sse chat_event');
      let event: ChatEventRecord;
      try {
        event = JSON.parse(raw.data) as ChatEventRecord;
      } catch (err) {
        console.error('[useSessionStream] malformed chat_event frame:', err);
        return;
      }

      queryClient.setQueryData<ChatEventRecord[]>(eventsKey, (prev) => {
        const list = prev ?? [];
        // Idempotent insert: stream + snapshot can deliver the same row
        // on first connect or after an invalidation. Skip dupes.
        if (list.some((e) => e.id === event.id)) return list;

        // Insert preserving (createdAt ASC, id ASC) — same ordering
        // the listChatEvents query uses. New events almost always
        // append; the sorted-insert path covers out-of-order writes
        // (e.g., a slow disk on one row + a fast write on the next).
        const out = [...list, event];
        out.sort((a, b) => {
          if (a.createdAt !== b.createdAt) {
            return a.createdAt < b.createdAt ? -1 : 1;
          }
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
        return out;
      });

      // Turn-completion landings (source='result') are the strongest
      // "this session moved buckets" signal — invalidate the rail so
      // its snapshot picks up the new lastOutcomeEventAt and the
      // server-side running/pending lists.
      if (event.source === 'result' || event.source === 'background_task') {
        invalidateRail();
      }

      // Tier-1 of the file-tree refresh strategy: when the agent emits
      // a tool_call that's likely to have mutated files (Edit, Write,
      // Bash `rm`/`mv`/redirects, etc.), invalidate the tree so the
      // file column repaints in the same frame as the edit. False
      // positives just trigger a cheap refetch.
      if (isMutatingToolUse(event)) {
        queryClient.invalidateQueries({ queryKey: treeKey() });
      }
    };

    const handleRuntime = (raw: MessageEvent) => {
      hot('sse runtime');
      try {
        const data = JSON.parse(raw.data) as { running: boolean };
        queryClient.setQueryData<SessionRuntimeStatus>(runtimeKey, (prev) =>
          withRunningStatus(prev, data.running));
        // Working bucket membership just flipped — re-fetch the rail.
        invalidateRail();
      } catch (err) {
        console.error('[useSessionStream] malformed runtime frame:', err);
      }
    };

    const handleBackgroundTasks = (raw: MessageEvent) => {
      try {
        const data = JSON.parse(raw.data) as { active: boolean; taskIds: string[] };
        queryClient.setQueryData<SessionRuntimeStatus>(runtimeKey, (prev) =>
          withBackgroundTaskStatus(prev, data.active, data.taskIds));
        invalidateRail();
      } catch (err) {
        console.error('[useSessionStream] malformed background_tasks frame:', err);
      }
    };

    const handlePendingInput = (raw: MessageEvent) => {
      hot('sse pending_input');
      try {
        const data = JSON.parse(raw.data) as { pending: PendingInput[] };
        queryClient.setQueryData<PendingInput[]>(pendingKey, data.pending);
        // Needs-approval bucket membership just shifted — re-fetch
        // so the rail reflects the new pending list.
        invalidateRail();
      } catch (err) {
        console.error('[useSessionStream] malformed pending_input frame:', err);
      }
    };

    const handleReconcile = (raw: MessageEvent) => {
      try {
        const data = JSON.parse(raw.data) as { status: 'started' | 'done'; replayed?: number };
        queryClient.setQueryData<boolean>(reconcilingKey, data.status === 'started');
      } catch (err) {
        console.error('[useSessionStream] malformed reconcile frame:', err);
      }
    };

    source.addEventListener('chat_event', handleChatEvent);
    source.addEventListener('runtime', handleRuntime);
    source.addEventListener('background_tasks', handleBackgroundTasks);
    source.addEventListener('pending_input', handlePendingInput);
    source.addEventListener('reconcile', handleReconcile);

    // Refetch authoritative state on every (re)connect. The server's
    // connect-time seed handles runtime + pending_input + a chat_event
    // replay since Last-Event-ID, but if the page was open across a
    // server restart, the React Query caches for `events` and
    // `runtime-status` can hold stale data that the seed alone won't
    // overwrite (e.g., events emitted between the old server's death
    // and the client's reconnect, which the new server's Last-Event-ID
    // resume can miss if the cap is hit, OR a stale `running:true`
    // from before the restart). Invalidate to force fresh reads.
    source.addEventListener('open', () => {
      queryClient.invalidateQueries({ queryKey: eventsKey });
      queryClient.invalidateQueries({ queryKey: runtimeKey });
    });

    source.onerror = (err) => {
      // EventSource auto-reconnects with backoff. We log once for
      // visibility but otherwise let the browser handle it.
      console.warn(`[useSessionStream] stream error for ${sessionId}:`, err);
    };

    return () => {
      source.removeEventListener('chat_event', handleChatEvent);
      source.removeEventListener('runtime', handleRuntime);
      source.removeEventListener('background_tasks', handleBackgroundTasks);
      source.removeEventListener('pending_input', handlePendingInput);
      source.removeEventListener('reconcile', handleReconcile);
      source.close();
    };
  }, [sessionId, queryClient]);
}
