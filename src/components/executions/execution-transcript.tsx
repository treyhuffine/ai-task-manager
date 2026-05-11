'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import { useSessionEvents } from '@/hooks/use-execution';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import type { ChatEventRecord, ChatSessionRecord, WorkspaceRecord } from '@/db/types';
import { ExecutionEvent } from './execution-event';
import { SetupCard } from './setup-card';
import { ThinkingState } from './thinking-state';

interface ExecutionTranscriptProps {
  session: ChatSessionRecord;
  workspace: WorkspaceRecord | undefined;
  isRunning: boolean;
  /** Event ids that this client sent via voice — drives the badge under user messages. */
  voiceSentIds?: ReadonlySet<string>;
}

/**
 * Transcript = SetupCard (always) + filtered chat_events + maybe a
 * ThinkingState while the agent is mid-turn.
 *
 * Filtering: `system` events with `subtype === 'init'` are noise — the
 * adapter already wrote `external_session_id` into the session row from
 * those events. Showing every "init" divider in the transcript clutters
 * the chat without telling the user anything. Other system subtypes
 * (compaction boundaries etc.) still render.
 *
 * ThinkingState renders the entire time the runtime says we're
 * running, anchored to the most recent user message's timestamp. The
 * timer ticks up from when the user hit send and persists through
 * thinking → tool calls → assistant text — only disappearing when the
 * agent's turn actually completes (runtime flips false). User asked
 * for this explicitly: "show a timer and don't stop it or hide it
 * until the agent sends its completion of its turn."
 */
export function ExecutionTranscript({ session, workspace, isRunning, voiceSentIds }: ExecutionTranscriptProps) {
  const { data: rawEvents, isLoading } = useSessionEvents(session.id);

  const events = useMemo(() => filterRenderable(rawEvents ?? []), [rawEvents]);
  const hasEvents = events.length > 0;

  // Latest user-event id — when this changes, the user just hit send
  // (or the polling caught up to it) and the view should snap to the
  // bottom regardless of where they had scrolled.
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
      if (events[i].source === 'user') return events[i].created_at;
    }
    return session.started_at;
  }, [events, session.started_at]);

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
            voiceSent={voiceSentIds?.has(event.id) ?? false}
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
 * Drop the meta `system` markers that don't help the user. Today this
 * is just `init`; if Claude / Codex emits other purely-mechanical
 * subtypes later we can add them here.
 */
function filterRenderable(events: ChatEventRecord[]): ChatEventRecord[] {
  return events.filter((e) => {
    if (e.source !== 'system') return true;
    const raw = (e.raw ?? {}) as { subtype?: string };
    return raw.subtype !== 'init';
  });
}
