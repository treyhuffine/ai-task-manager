'use client';

import { ConnectedCompanion } from '@/components/mcp-apps/companion';

/**
 * An app beside a chat (docs/connected-mcp-apps.md): the chat keeps its whole
 * surface and a connected app takes a pane at its right, under it when the
 * chat is narrow. Nothing shows until an app is opened here, from the
 * composer's + menu (`AppCompanionRows`), a tool result expanded out of the
 * transcript, or a mention. One pane per chat, so switching chats never
 * carries an app across.
 */
export function AppCompanion({ chatId, children }: { chatId: string; children: React.ReactNode }) {
  return <ConnectedCompanion key={chatId} chatId={chatId}>{() => children}</ConnectedCompanion>;
}
