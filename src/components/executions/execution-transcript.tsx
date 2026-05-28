'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import { useSessionEvents, useClientEventStatus } from '@/hooks/use-execution';
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
    <Conversation className="flex-1 min-h-0">
      <ConversationContent className="gap-3 px-5 pt-4 pb-8 max-w-3xl mx-auto">
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
 * Drop transcript noise:
 *   - `system` events with subtype `init` — agentex always emits one
 *     at session start; the row is useful for the `externalSessionId`
 *     capture but adds nothing to the chat surface.
 *   - `result` events entirely — the row exists for analytics
 *     (cost/usage/stopReason live in `raw`), but the user-visible
 *     "turn complete" signal is the composer re-enabling. Rendering a
 *     pill after every turn just clutters the transcript.
 */
function filterRenderable(events: ChatEventRecord[]): ChatEventRecord[] {
  return events.filter((e) => {
    if (e.source === 'result') return false;
    if (e.source !== 'system') return true;
    const raw = (e.raw ?? {}) as { subtype?: string };
    return raw.subtype !== 'init';
  });
}
