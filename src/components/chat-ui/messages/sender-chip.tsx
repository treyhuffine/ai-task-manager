'use client';

import type { ReactNode } from 'react';
import { ChatMessageLink } from './chat-message-link';

/**
 * Authenticated sender identity, shared by requests, ordinary messages and
 * automatic returns. It belongs to the incoming message's header. Messages
 * the user typed have no sender reference. `action` sits beside the link,
 * outside it (a returned result's Archive chat).
 */
export function SenderChip({ senderSessionId, eventId, label = 'Message from', action }: { senderSessionId: string; eventId?: string; label?: string; action?: ReactNode }) {
  const link = <ChatMessageLink sessionId={senderSessionId} eventId={eventId} label={label} direction="incoming" header />;
  if (!action) return link;
  // Beside the link while the card is wide enough to keep the chat's name
  // readable, and below it, at the right, on a narrow one (a phone).
  return <div className="flex min-w-0 flex-wrap items-center gap-x-1">
    <div className="min-w-0 flex-[1_1_14rem]">{link}</div>
    {action}
  </div>;
}
