'use client';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useStickToBottomContext } from 'use-stick-to-bottom';

// Layout effect that no-ops to a passive effect during SSR — the
// transcript is a client component but still renders once on the server,
// where useLayoutEffect would warn.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
import { Loader2 } from 'lucide-react';
import { useSessionEvents, useClientEventStatus, useLoadOlderEvents } from '@/hooks/use-execution';
import { hot } from '@/lib/_debug/hot-path';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import type { ChatEventRecord, ChatSessionWithExecution, WorkspaceRecord } from '@/db/types';
import { ExecutionEvent } from './execution-event';
import { ActivityGroup } from './activity-group';
import { TurnFilesFooter } from './file-chip';
import { buildTranscriptNodes } from './transcript-grouping';
import { useTranscriptDensity } from '@/lib/client/transcript-density';
import { isPlumbingTool } from '@/lib/executions/tool-display';
import { NO_RESPONSE_REQUESTED } from '@/lib/executions/conversation';
import { SetupCard } from './setup-card';
import { ThinkingState } from './thinking-state';

interface ExecutionTranscriptProps {
  session: ChatSessionWithExecution;
  workspace: WorkspaceRecord | undefined;
  isRunning: boolean;
  /** Event ids that this client sent via voice — drives the badge under user messages. */
  voiceSentIds?: ReadonlySet<string>;
}

/**
 * Transcript = SetupCard (always) + filtered chat_events + a
 * ThinkingState while the agent is mid-turn.
 *
 * Filtering: `system` events with `subtype === 'init'` are noise — the
 * adapter already wrote `externalSessionId` into the session row from
 * those events. Showing every "init" divider in the transcript clutters
 * the chat without telling the user anything. Other system subtypes
 * (compaction boundaries etc.) still render.
 *
 * ThinkingState renders the entire time the runtime says we're
 * running, anchored to the most recent user message's timestamp. The
 * timer ticks up from when the user hit send and persists through
 * thinking → tool calls → assistant text — only disappearing when the
 * agent's turn actually completes (runtime flips false).
 *
 * When `isRunning` is false, the transcript shows no special
 * affordance — the composer being enabled is the canonical signal
 * that the user can respond. The previous "may be incomplete" pill
 * was removed because agentex's session.ts (0.0.11+) only forwards
 * the `result` event to `onEvent` for the auth-failure case, so the
 * "trailing non-terminal event" heuristic produced all false positives
 * on normal completed turns.
 */
export function ExecutionTranscript({ session, workspace, isRunning, voiceSentIds }: ExecutionTranscriptProps) {
  hot('render ExecutionTranscript');
  const { data: rawEvents, isLoading } = useSessionEvents(session.id);
  const clientStatus = useClientEventStatus(session.id);
  const { loadOlder, isLoadingOlder, hasOlder } = useLoadOlderEvents(session.id, rawEvents);
  const { density } = useTranscriptDensity();

  const events = useMemo(() => filterRenderable(rawEvents ?? []), [rawEvents]);
  const hasEvents = events.length > 0;

  // Pair each `tool_result` to its `tool_call` (via externalToolCallId) so
  // a call row can render the result's summary inline ("150 lines"). Built
  // from the full event list before any suppression.
  const resultByCallId = useMemo(() => {
    const m = new Map<string, ChatEventRecord>();
    for (const e of events) {
      if (e.source === 'tool_result' && e.externalToolCallId) m.set(e.externalToolCallId, e);
    }
    return m;
  }, [events]);

  // In condensed mode, drop the rows we merge/fold away so they neither
  // render standalone nor inflate counts:
  //   - tool_result rows whose tool_call is present (merged onto the call)
  //   - PTY plumbing calls (Codex write_stdin/read_thread_terminal)
  const renderEvents = useMemo(() => {
    if (density !== 'condensed') return events;
    const callIds = new Set<string>();
    for (const e of events) {
      if (e.source === 'tool_call' && e.externalToolCallId) callIds.add(e.externalToolCallId);
    }
    return events.filter((e) => {
      if (e.source === 'tool_result' && e.externalToolCallId && callIds.has(e.externalToolCallId)) {
        return false;
      }
      if (e.source === 'tool_call' && isPlumbingTool(e.toolName)) return false;
      return true;
    });
  }, [events, density]);

  // Condensed (default) folds each completed turn's intermediate activity
  // into a collapsible summary; `full` renders every event. Recomputes
  // when the live turn finishes (isRunning) so it collapses on completion.
  const nodes = useMemo(
    () => buildTranscriptNodes(renderEvents, { isRunning, density }),
    [renderEvents, isRunning, density],
  );

  // Index lookups for per-event flags (auth banner actionability, last row).
  const eventIndex = useMemo(() => {
    const m = new Map<string, number>();
    renderEvents.forEach((e, i) => m.set(e.id, i));
    return m;
  }, [renderEvents]);
  const lastUserIdx = useMemo(() => {
    for (let i = renderEvents.length - 1; i >= 0; i--) if (renderEvents[i].source === 'user') return i;
    return -1;
  }, [renderEvents]);

  // Cursor for scroll-up paging + the layout-effect key that fires the
  // re-anchor: the RAW oldest event (unfiltered — that's what the pager
  // sends as `before` and what changes when an older page lands).
  const oldestEventId = rawEvents && rawEvents.length > 0 ? rawEvents[0].id : null;

  // Latest user-event id — when this changes, the user just hit send
  // and the view should snap to the bottom regardless of where they
  // had scrolled.
  const latestUserEventId = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].source === 'user') return events[i].id;
    }
    return null;
  }, [events]);

  const thinkingSince = useMemo(() => {
    // Anchor the elapsed counter to the latest user message — that's
    // when the user actually clicked send. Falls back to session start
    // when there are no events yet (fresh execution mid-spawn).
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].source === 'user') return events[i].createdAt;
    }
    return session.startedAt;
  }, [events, session.startedAt]);

  return (
    <Conversation className="flex-1 min-h-0" initial="instant">
      <ConversationContent className="gap-3 px-5 pt-4 pb-8 max-w-3xl mx-auto">
        <InitialScrollSnap sessionId={session.id} ready={!isLoading} />
        <ScrollUpPager
          ready={!isLoading}
          hasOlder={hasOlder}
          isLoadingOlder={isLoadingOlder}
          loadOlder={loadOlder}
          oldestEventId={oldestEventId}
        />
        <SetupCard session={session} workspace={workspace} />

        {isLoading && !hasEvents && (
          <p className="text-[11px] text-muted-foreground/60 italic">Loading transcript…</p>
        )}

        {nodes.map((node) => {
          if (node.kind === 'group') {
            return (
              <ActivityGroup
                key={node.id}
                node={node}
                sessionId={session.id}
                resultByCallId={resultByCallId}
              />
            );
          }
          if (node.kind === 'files') {
            return <TurnFilesFooter key={node.id} files={node.files} />;
          }
          const event = node.event;
          const idx = eventIndex.get(event.id) ?? -1;
          return (
            <ExecutionEvent
              key={event.id}
              event={event}
              sessionId={session.id}
              // Merge result summaries onto call rows only in condensed
              // mode; in full mode the standalone result row owns it.
              resultByCallId={density === 'condensed' ? resultByCallId : undefined}
              isLast={idx === renderEvents.length - 1}
              // For `auth_required`: the trailing `result` event from the
              // same failed turn means `isLast` is false even though no
              // new user message has been sent. Treat the banner as still
              // actionable until the user actually moves past it with a
              // fresh message — i.e. no user event sent after it.
              isLatestUnresolved={event.source === 'auth_required' && idx > lastUserIdx}
              voiceSent={voiceSentIds?.has(event.id) ?? false}
              clientStatus={clientStatus[event.id]}
            />
          );
        })}

        {isRunning && <ThinkingState since={thinkingSince} />}
        <ScrollOnSend trigger={latestUserEventId} />
      </ConversationContent>
      {isLoadingOlder && (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
          <span className="flex items-center gap-1.5 rounded-full border bg-background/90 px-3 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
            <Loader2 className="size-3 animate-spin" />
            Loading earlier messages…
          </span>
        </div>
      )}
      <ConversationScrollButton />
    </Conversation>
  );
}

/**
 * Snaps to the bottom *instantly* on the initial load of each session —
 * users expect to open straight at the latest message, not watch a
 * scroll animation play out.
 *
 * Why this exists alongside `initial="instant"`: that prop only governs
 * the StickToBottom library's very first scroll-on-mount. But
 * ExecutionView doesn't remount between sessions, and events load async,
 * so for every session switch (and every first-time open) the first real
 * content growth is a *resize* — which uses the smooth `resize` animation,
 * producing the unwanted glide. Here we set `scrollTop` directly in a
 * layout effect (synchronously, before paint) so no animation is ever
 * visible. Streaming growth, sends (`ScrollOnSend`), and the scroll-down
 * arrow keep their smooth behavior — those still go through the library.
 *
 * Fires once per session id; the ref reset handles the reused instance
 * across session switches. `ready` (events settled) ensures `scrollHeight`
 * reflects the loaded transcript before we jump. Renders nothing.
 */
function InitialScrollSnap({ sessionId, ready }: { sessionId: string; ready: boolean }) {
  const { scrollRef } = useStickToBottomContext();
  const snappedFor = useRef<string | null>(null);
  useIsoLayoutEffect(() => {
    if (!ready || snappedFor.current === sessionId) return;
    const el = scrollRef.current;
    if (!el) return;
    snappedFor.current = sessionId;
    el.scrollTop = el.scrollHeight;
  }, [sessionId, ready, scrollRef]);
  return null;
}

/** Start a fetch of the previous page once the user scrolls within this
 *  many pixels of the top — preload before they hit the very top so the
 *  older messages are usually already there. */
const SCROLL_UP_THRESHOLD_PX = 400;

/**
 * Infinite scroll-up. The transcript snapshot only loads the most recent
 * page (`CHAT_PAGE_SIZE`); this watches the scroll position and pages
 * older history in as the user nears the top, prepending it to the same
 * events cache.
 *
 * The hard part is keeping the viewport still while content grows ABOVE
 * it. `use-stick-to-bottom` only ever sticks to the *bottom* — on a
 * positive resize while scrolled up it calls a `scrollToBottom` that
 * immediately bails (we're not at the bottom), so it neither helps nor
 * fights us. We capture `scrollHeight/scrollTop` at trigger time and, in
 * a layout effect that runs the moment the older page commits (keyed on
 * the oldest event id), set `scrollTop = newHeight - prevHeight + prevTop`
 * — re-anchoring the exact message the user was reading. The layout
 * effect runs before the library's ResizeObserver fires, and our
 * programmatic scroll lands inside its resize window so it's correctly
 * ignored (no `isAtBottom` flip). Renders nothing.
 */
function ScrollUpPager({
  ready,
  hasOlder,
  isLoadingOlder,
  loadOlder,
  oldestEventId,
}: {
  ready: boolean;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  loadOlder: () => Promise<number>;
  oldestEventId: string | null;
}) {
  const { scrollRef } = useStickToBottomContext();
  // Scroll metrics captured at trigger time; consumed by the layout
  // effect once the older page renders. Non-null = a load is in flight
  // and its prepend hasn't been anchored yet.
  const pending = useRef<{ prevHeight: number; prevTop: number } | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (!ready || !hasOlder || isLoadingOlder || pending.current) return;
      if (el.scrollTop > SCROLL_UP_THRESHOLD_PX) return;
      pending.current = { prevHeight: el.scrollHeight, prevTop: el.scrollTop };
      loadOlder()
        .then((added) => {
          // Empty page → no commit will change `oldestEventId`, so the
          // anchor effect won't run to clear this. Release it here.
          if (!added) pending.current = null;
        })
        .catch(() => {
          pending.current = null;
        });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollRef, ready, hasOlder, isLoadingOlder, loadOlder]);

  useIsoLayoutEffect(() => {
    const el = scrollRef.current;
    const p = pending.current;
    if (!el || !p) return;
    el.scrollTop = el.scrollHeight - p.prevHeight + p.prevTop;
    pending.current = null;
  }, [oldestEventId, scrollRef]);

  return null;
}

/**
 * Force-scrolls the conversation to the bottom whenever a new user
 * event lands. The Conversation's stick-to-bottom only auto-scrolls
 * when the user is already pinned to the bottom; without this, sending
 * a message while scrolled up leaves the new turn off-screen.
 *
 * Lives inside `<Conversation>` so it can read the StickToBottom
 * context. Renders nothing.
 */
function ScrollOnSend({ trigger }: { trigger: string | null }) {
  const { scrollToBottom } = useStickToBottomContext();
  const lastRef = useRef<string | null>(trigger);
  useEffect(() => {
    if (trigger && trigger !== lastRef.current) {
      scrollToBottom();
    }
    lastRef.current = trigger;
  }, [trigger, scrollToBottom]);
  return null;
}

/**
 * `system`-source events are `type:"system"` telemetry/lifecycle markers
 * the adapter stores as `--- subtype ---` dividers (`init`, `mode`,
 * `thinking_tokens`, `task_started`/`task_notification`, `commands_changed`,
 * …). The set is open-ended — Claude Code / agentex add new subtypes freely
 * — so a denylist is endless whack-a-mole. We allowlist instead: render only
 * subtypes that carry genuine user value (currently none). Anything not
 * listed is dropped from the transcript but kept in `chat_events` (raw) for
 * debugging. If we later want to surface, say, a compaction boundary, it
 * should get a purpose-built styled affordance — not a raw divider — so add
 * it here only alongside that.
 */
const RENDERABLE_SYSTEM_SUBTYPES = new Set<string>([]);

/**
 * Drop transcript noise:
 *   - `system` events with subtype `init` — agentex always emits one
 *     at session start; the row is useful for the `externalSessionId`
 *     capture but adds nothing to the chat surface.
 *   - `result` events entirely — the row exists for analytics
 *     (cost/usage/stopReason live in `raw`), but the user-visible
 *     "turn complete" signal is the composer re-enabling. Rendering a
 *     pill after every turn just clutters the transcript.
 *   - `agent` events that are Claude Code's synthetic
 *     `No response requested.` placeholder — see the constant above.
 */
function filterRenderable(events: ChatEventRecord[]): ChatEventRecord[] {
  return events.filter((e) => {
    if (e.source === 'result') return false;
    if (e.source === 'agent' && e.content === NO_RESPONSE_REQUESTED) return false;
    // Empty `thinking` rows carry no prose (Claude Code withholds it on
    // current versions — see docs/agentex-thinking-capture-spec.md). An
    // accordion that expands to nothing is pure noise, so drop them; the
    // renderer auto-shows thinking again the moment prose is present.
    if (e.source === 'thinking' && !(e.content ?? '').trim()) return false;
    if (e.source !== 'system') return true;
    // Allowlist: render a system divider only for subtypes we've opted into
    // (none today). The subtype lives in `content` (the adapter stores
    // `event.subtype` there); `raw.subtype` is unreliable (`'unknown'` for
    // forward-compat events), so prefer `content`.
    const raw = (e.raw ?? {}) as { subtype?: string };
    const subtype = e.content ?? raw.subtype ?? '';
    return RENDERABLE_SYSTEM_SUBTYPES.has(subtype);
  });
}
