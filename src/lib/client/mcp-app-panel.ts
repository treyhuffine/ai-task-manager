'use client';
import { createContext, useContext } from 'react';
import type { McpIcon } from '@/lib/integrations/mcp-icons';

/** An app's thread tab (OpenAI's thread entrypoint): a connection's tool that opens beside a chat. */
export interface ConnectedTab { serverId: string; name: string; title: string; icons?: McpIcon[] }

/** Chat navigation only. Text mentions do not import or load the UI renderer. */
export const ConnectedCompanionContext = createContext<{
  /** The chat this companion sits beside. */
  chatId: string;
  captureId: string | null;
  open: (id: string | null) => void;
  mount: HTMLDivElement | null;
  register: (id: string) => () => void;
  /** The thread tab beside this chat, when one is open. */
  tab?: ConnectedTab | null;
  /** Open an app's thread tab beside this chat, or return to it when it is already open. */
  openTab?: (tab: ConnectedTab, options?: { fresh?: boolean }) => Promise<void>;
} | null>(null);
export const useConnectedCompanion = () => useContext(ConnectedCompanionContext);
