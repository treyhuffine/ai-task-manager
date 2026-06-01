'use client';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useStickToBottomContext } from 'use-stick-to-bottom';

// Layout effect that no-ops to a passive effect during SSR — the
// transcript is a client component but still renders once on the server,
// where useLayoutEffect would warn.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
import { useSessionEvents, useClientEventStatus } from '@/hooks/use-execution';
import { hot } from '@/lib/_debug/hot-path';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import type { ChatEventRecord, ChatSessionWithExecution, WorkspaceRecord } from '@/db/types';
import { ExecutionEvent } from './execution-event';
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

  const events = useMemo(() => filterRenderable(rawEvents ?? []), [rawEvents]);
  const hasEvents = events.length > 0;

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
        <SetupCard session={session} workspace={workspace} />

        {isLoading && !hasEvents && (
          <p className="text-[11px] text-muted-foreground/60 italic">Loading transcript…</p>
        )}

        {events.map((event, i) => (
          <ExecutionEvent
            key={event.id}
            event={event}
            sessionId={session.id}
            isLast={i === events.length - 1}
            // For `auth_required`: the trailing `result` event from the
            // same failed turn means `isLast` is false even though no
            // new user message has been sent. Treat the banner as still
            // actionable until the user actually moves past it with a
            // fresh message — that's the user-perceived "did I deal
            // with this yet" boundary, not the literal last-row index.
            isLatestUnresolved={
              event.source === 'auth_required' &&
              !events.slice(i + 1).some((e) => e.source === 'user')
            }
            voiceSent={voiceSentIds?.has(event.id) ?? false}
            clientStatus={clientStatus[event.id]}
          />
        ))}

        {isRunning && <ThinkingState since={thinkingSince} />}
        <ScrollOnSend trigger={latestUserEventId} />
      </ConversationContent>
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
 * Synthetic assistant text Claude Code injects to keep its own
 * conversation history API-valid when a turn produced no real output —
 * e.g. a silently-handled rate-limit/model fallback, or a recovered
 * interrupted turn. agentex forwards it on the stream, so it lands here
 * as an `agent` row with this exact content.
 *
 * The Claude Code TUI never paints it: its `AssistantTextMessage`
 * renderer does `case NO_RESPONSE_REQUESTED: return null`. We match that
 * behavior — the row stays in `chat_events` (raw kept for debugging,
 * same as `result`/`init`), it's just filtered out of the transcript.
 * Wrapper apps that don't replicate this filter are exactly why the
 * string leaks into their UI.
 *
 * Mirrors `NO_RESPONSE_REQUESTED` in Claude Code's `utils/messages.ts`.
 */
const NO_RESPONSE_REQUESTED = 'No response requested.';

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
    if (e.source !== 'system') return true;
    const raw = (e.raw ?? {}) as { subtype?: string };
    return raw.subtype !== 'init';
  });
}
