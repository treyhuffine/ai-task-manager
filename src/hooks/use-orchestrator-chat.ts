import {
  mainChatHistoryKey,
  mainChatKey,
  useMainChat,
  useMainChatHistory,
  useNewMainChat,
  useResumeMainChat,
  type MainChatHistoryEntry,
} from './use-main-chat';

/**
 * The app's main chat: the interactive orchestrator chat (harness modes).
 * A thin binding of `use-main-chat.ts` to scope `null`, which an agent's
 * main chat shares with its workspace id.
 */

export const ORCHESTRATOR_CHAT_KEY = mainChatKey(null);
export const ORCHESTRATOR_CHAT_HISTORY_KEY = mainChatHistoryKey(null);

export type OrchestratorChatHistoryEntry = MainChatHistoryEntry;

/** The current orchestrator chat. GET creates one if none exists. */
export function useOrchestratorChat(enabled = true) {
  return useMainChat(null, enabled);
}

/** Start a fresh orchestrator chat (optionally on another provider/model). */
export function useNewOrchestratorChat() {
  return useNewMainChat(null);
}

/** Past and current orchestrator chats, newest activity first. */
export function useOrchestratorChatHistory(enabled: boolean) {
  return useMainChatHistory(null, enabled);
}

/** Resume a past orchestrator chat as the current one. */
export function useResumeOrchestratorChat() {
  return useResumeMainChat(null);
}
