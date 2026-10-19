'use client';
import { createContext, useContext } from 'react';
import type { McpIcon } from '@/lib/integrations/mcp-icons';

/** An app's thread tab (OpenAI's thread entrypoint): a connection's tool that opens beside a chat. */
export interface ConnectedTab { serverId: string; name: string; title: string; icons?: McpIcon[] }

/** What the pane beside a chat holds now, for deciding whether a result may place itself there. */
export interface CompanionState {
  captureId: string | null;
  /** The thread tab shown, when the capture is one. */
  tab: ConnectedTab | null;
  /** A tab is still opening (launching, or waiting on an approval). */
  opening: boolean;
  /** The capture a result's display mode placed there, rather than the person. */
  placedId: string | null;
}

/**
 * Whether a fresh result whose display mode prefers full screen may open
 * beside the chat on its own. Only into an empty pane, or over another result
 * placed the same way: what the person opened (a tab, a result they moved
 * there) stays until they choose to replace it. A replaced result goes back
 * into the transcript with its view intact.
 */
export function mayPlaceResult(state: CompanionState): boolean {
  if (state.opening || state.tab) return false;
  return !state.captureId || state.captureId === state.placedId;
}

/** Chat navigation only. Text mentions do not import or load the UI renderer. */
export const ConnectedCompanionContext = createContext<{
  /** The chat this companion sits beside. */
  chatId: string;
  captureId: string | null;
  /** Show a capture beside the chat because the person asked, or `null` to close it. */
  open: (id: string | null) => void;
  /** Show a fresh result beside the chat because its display mode asks, when `mayPlaceResult` allows. */
  place?: (id: string) => void;
  mount: HTMLDivElement | null;
  register: (id: string) => () => void;
  /** The thread tab beside this chat, when one is open. */
  tab?: ConnectedTab | null;
  /** Open an app's thread tab beside this chat, or return to it when it is already open. */
  openTab?: (tab: ConnectedTab, options?: { fresh?: boolean }) => Promise<void>;
} | null>(null);
export const useConnectedCompanion = () => useContext(ConnectedCompanionContext);
