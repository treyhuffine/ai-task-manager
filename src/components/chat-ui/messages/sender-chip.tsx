'use client';

import { ChatMessageLink } from './chat-message-link';

/**
 * Authenticated sender identity, shared by requests, ordinary messages and
 * automatic returns. It belongs to the incoming message's header. Messages
 * the user typed have no sender reference.
 */
export function SenderChip({ senderSessionId, label = 'Message from' }: { senderSessionId: string; label?: string }) {
  return <ChatMessageLink sessionId={senderSessionId} label={label} direction="incoming" header />;
}
