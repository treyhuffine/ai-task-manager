'use client';

/**
 * "Sends to" for a trigger whose target is one existing chat
 * (`targetKind: 'session'`). That chat keeps its own provider and model, so
 * this replaces the "Runs on" picker: it names the chat and opens it. A chat
 * that has been archived or deleted is said plainly, since the next fire
 * pauses the trigger for that reason.
 */

import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
import { useSession } from '@/hooks/use-execution';
import type { TriggerConcurrencyPolicy } from '@/db/types';

export function TriggerTargetChat({
  sessionId,
  concurrencyPolicy,
}: {
  sessionId: string | null;
  concurrencyPolicy: TriggerConcurrencyPolicy;
}) {
  const { data: chat, isLoading } = useSession(sessionId);

  if (!sessionId || (!isLoading && !chat)) {
    return (
      <p className="text-sm text-muted-foreground">
        The chat this trigger sent to no longer exists, so it pauses on its next fire.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <Link
        href={`/?session=${sessionId}`}
        className="flex items-center gap-2 p-2 rounded-md border border-border bg-card hover:bg-muted text-sm"
      >
        <MessageCircle size={14} className="flex-shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate">{chat?.label ?? (isLoading ? 'Loading…' : 'Untitled chat')}</span>
      </Link>
      <p className="text-[11px] text-muted-foreground">
        {chat?.status === 'archived'
          ? 'This chat is archived, so the trigger pauses on its next fire.'
          : `Each fire arrives in this chat as a message from the trigger, on the chat’s own model. ${
              concurrencyPolicy === 'coalesce_if_active'
                ? 'A fire while the chat is busy joins the turn under way.'
                : 'A fire while the chat is busy is skipped.'
            } One while its incoming messages are paused is skipped.`}
      </p>
    </div>
  );
}
