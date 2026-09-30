'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isNewerRevision, type ChatEventDTO } from '@/lib/api/dto/chat-event';
import type { PendingInput } from '@/lib/api/sessions';
import { isMutatingToolUse } from '@/lib/executor/mutation-detect';
import { worktreeScopeFromCache } from '@/hooks/use-execution';
import { hot } from '@/lib/_debug/hot-path';
import { invalidateRailSoon } from '@/lib/query/invalidate-rail';
import {
  withBackgroundTaskStatus,
  withRunningStatus,
  type SessionRuntimeStatus,
} from '@/lib/executor/runtime-status';
import type { MessageDelivery } from '@/lib/workers/delivery';
import { noteDeliveryUpdate } from '@/lib/query/delivery-fence';
import { pageStream } from '@/lib/realtime/page-stream';
import { connectorApprovalsKey } from '@/hooks/use-connector-approvals';

/**
 * Subscribes to the session's frames and folds every frame into
 * the matching TanStack Query cache:
 *
 *   - `chat_event`   → appends-with-dedup into `['session', id, 'events']`
 *   - `runtime`      → replaces `['session', id, 'runtime-status']`
 *   - `background_tasks` → updates the detached-work axis of runtime status
 *   - `pending_input`→ replaces `['session', id, 'pending-input']`
 *   - `connector_approvals` → replaces `['session', id, 'connector-approvals']`
 *
 * Replaces the three independent polls (3s/2s/1.5s) those caches used
 * to drive. Snapshot fetches still fire on mount + window focus as a
 * fallback if the stream is unavailable; on a healthy stream they're
 * superfluous but harmless (dedup-by-id keeps overlap correct).
 *
 * The frames come over the page's one stream (`pageStream()`, P3
 * review), which reconnects with the last chat event this page saw, so
 * the server replays the rows missed (`listChatEventsToResume`): laptop
 * sleep, a network blip or a hidden tab lose nothing. When it can't
 * replay all of it, its `ready` says so and the transcript is refetched.
 *
 * Cookie auth carries the session; EventSource can't attach headers
 * but cookies flow natively and `proxy.ts` accepts either Bearer or
 * cookie. No client-side auth wiring needed.
 */
export function useSessionStream(sessionId: string | null): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!sessionId) return;

    const eventsKey = ['session', sessionId, 'events'] as const;
    const deliveriesKey = ['session', sessionId, 'deliveries'] as const;
    const runtimeKey = ['session', sessionId, 'runtime-status'] as const;
    const pendingKey = ['session', sessionId, 'pending-input'] as const;
    const approvalsKey = connectorApprovalsKey(sessionId);
    const reconcilingKey = ['session', sessionId, 'reconciling'] as const;
    // Tier-1 tree refresh. Resolved at fire time rather than closed over,
    // because the tree is cached per *execution* and the scope depends on
    // the session row being in cache — which it is by the time any frame
    // arrives, but isn't guaranteed when this effect first runs.
    const treeKey = () => [...worktreeScopeFromCache(queryClient, sessionId), 'tree'] as const;
    // The diff and its totals (the workbench's Changes view, the tools box
    // and the rail's +/- counts) follow the same edits, debounced so a
    // burst of edits costs one refetch. Only on-screen queries refetch.
    let diffTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleDiffRefresh = () => {
      if (diffTimer) clearTimeout(diffTimer);
      diffTimer = setTimeout(() => {
        diffTimer = null;
        const scope = worktreeScopeFromCache(queryClient, sessionId);
        queryClient.invalidateQueries({ queryKey: [...scope, 'diff'] });
        queryClient.invalidateQueries({ queryKey: [...scope, 'diff-stats'] });
      }, 1_500);
    };

    // Any state change for this session that the rail cares about —
    // turn finished, runtime flipped, pending request changed — is a
    // signal to re-fetch the rail. Cheaper than a global SSE channel
    // and snaps the rail's buckets to reality as soon as the viewed
    // session moves between them.
    // Coalesced across streams and bursts (invalidateRailSoon).
    const invalidateRail = () => invalidateRailSoon(queryClient);

    const handleChatEvent = (data: unknown) => {
      hot('sse chat_event');
      const event = data as ChatEventDTO | null;
      if (!event?.id) {
        console.error('[useSessionStream] malformed chat_event frame');
        return;
      }

      queryClient.setQueryData<ChatEventDTO[]>(eventsKey, (prev) => {
        const list = prev ?? [];
        // Idempotent insert: stream + snapshot can deliver the same row
        // on first connect or after an invalidation. Skip dupes, but take
        // a newer revision of a part that grows in place (OpenCode's
        // cumulative text), live or replayed on resume (P3 re-check).
        const at = list.findIndex((e) => e.id === event.id);
        if (at >= 0) {
          if (!isNewerRevision(event, list[at]!)) return list;
          const out = [...list];
          out[at] = event;
          return out;
        }

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
        scheduleDiffRefresh();
      }
    };

    const handleRuntime = (frame: unknown) => {
      hot('sse runtime');
      const data = frame as { running: boolean };
      queryClient.setQueryData<SessionRuntimeStatus>(runtimeKey, (prev) =>
        withRunningStatus(prev, data.running));
      // Working bucket membership just flipped — re-fetch the rail.
      invalidateRail();
    };

    const handleBackgroundTasks = (frame: unknown) => {
      const data = frame as { active: boolean; taskIds: string[] };
      queryClient.setQueryData<SessionRuntimeStatus>(runtimeKey, (prev) =>
        withBackgroundTaskStatus(prev, data.active, data.taskIds));
      invalidateRail();
    };

    const handlePendingInput = (frame: unknown) => {
      hot('sse pending_input');
      const data = frame as { pending: PendingInput[] };
      queryClient.setQueryData<PendingInput[]>(pendingKey, data.pending);
      // Needs-approval bucket membership just shifted — re-fetch
      // so the rail reflects the new pending list.
      invalidateRail();
    };

    // Live connector approval ids: approval cards offer buttons only for these.
    const handleConnectorApprovals = (frame: unknown) => {
      const data = frame as { pending: string[] };
      queryClient.setQueryData<string[]>(approvalsKey, data.pending);
    };

    const handleReconcile = (frame: unknown) => {
      const data = frame as { status: 'started' | 'done'; replayed?: number };
      queryClient.setQueryData<boolean>(reconcilingKey, data.status === 'started');
    };

    // Where a message sent to a device elsewhere stands (P3.2).
    const handleDelivery = (frame: unknown) => {
      const data = frame as { eventId: string; delivery: MessageDelivery };
      noteDeliveryUpdate(sessionId, data.eventId);
      queryClient.setQueryData<Record<string, MessageDelivery>>(deliveriesKey, (prev) => ({ ...(prev ?? {}), [data.eventId]: data.delivery }));
    };

    // Where a move between devices stands (P4.2). When ownership changes,
    // where the execution runs, its folder and its messages all change too.
    const transferKey = ['session', sessionId, 'transfer'] as const;
    const handleTransfer = (frame: unknown) => {
      const data = frame as { transfer: { state: string; ownershipChanged: boolean } | null };
      const prev = queryClient.getQueryData<{ state: string; ownershipChanged: boolean } | null>(transferKey);
      queryClient.setQueryData(transferKey, data.transfer);
      if (data.transfer && (data.transfer.ownershipChanged !== prev?.ownershipChanged || data.transfer.state !== prev?.state)) {
        queryClient.invalidateQueries({ queryKey: ['session', sessionId], exact: true });
        queryClient.invalidateQueries({ queryKey: deliveriesKey });
        queryClient.invalidateQueries({ queryKey: treeKey() });
        invalidateRail();
      }
    };

    // Refetch authoritative state on every (re)connect, which the chat's
    // `ready` marks. A fresh start refetches the transcript and runtime too:
    // the seed alone can't overwrite state left from before a server
    // restart. A resume replayed all the transcript missed already, parts
    // revised in place included: the server says it resumed only then, and
    // otherwise replays nothing (P3 re-check). Deliveries and the move
    // aren't replayed, so they're refetched either way.
    const handleReady = (frame: unknown, caughtUp?: () => void) => {
      const data = frame as { resumed?: boolean; position?: { after?: string | null } } | null;
      if (data?.resumed !== true) {
        void readTranscriptAfresh(data?.position?.after ?? null, caughtUp);
        queryClient.invalidateQueries({ queryKey: runtimeKey });
      }
      queryClient.invalidateQueries({ queryKey: deliveriesKey });
      queryClient.invalidateQueries({ queryKey: transferKey });
    };

    // The transcript read afresh, then acknowledged to the page stream once
    // the cache has the event `ready` named as the transcript's last: only
    // then does the chat resume from there. A read already under way when
    // `ready` came can't vouch for it (the refetch joins it), so a second
    // one is asked for before giving up (P3 re-check).
    const readTranscriptAfresh = async (last: string | null, caughtUp?: () => void) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await queryClient.invalidateQueries({ queryKey: eventsKey });
        } catch {
          return;
        }
        if (!last || queryClient.getQueryData<ChatEventDTO[]>(eventsKey)?.some((e) => e.id === last)) {
          caughtUp?.();
          return;
        }
      }
    };

    const handlers: Record<string, (data: unknown, caughtUp?: () => void) => void> = {
      chat_event: handleChatEvent,
      delivery: handleDelivery,
      transfer: handleTransfer,
      runtime: handleRuntime,
      background_tasks: handleBackgroundTasks,
      pending_input: handlePendingInput,
      connector_approvals: handleConnectorApprovals,
      reconcile: handleReconcile,
      ready: handleReady,
    };
    // Carried by the page's one stream (P3 review).
    const unsubscribe = pageStream().subscribeSession(sessionId, (event, data, _id, caughtUp) => {
      try {
        handlers[event]?.(data, caughtUp);
      } catch (err) {
        console.error(`[useSessionStream] malformed ${event} frame:`, err);
      }
    });

    return () => {
      unsubscribe();
      if (diffTimer) clearTimeout(diffTimer);
    };
  }, [sessionId, queryClient]);
}

