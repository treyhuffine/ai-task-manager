import type { AgentChatPlace } from './agent-chat-place';

/**
 * Where a chat opened from inside an agent's view goes (docs/agents-view-spec.md,
 * "Chats beside the agent"):
 *
 *   - `here`: it's the agent's own main chat, already on screen on the left.
 *   - `full`: its full execution view. When there's no room for two panes
 *     (a phone, a narrow window), when the person set chats to open in full
 *     view, where the view can't keep a chat beside (a team's agent view),
 *     or when whoever opened it asked for one of the workbench's tools (the
 *     archive dialog's Review asks for Changes).
 *   - `beside`: in the tools panel, beside the main chat.
 */
export type AgentChatOpening = 'here' | 'full' | 'beside';

export function routeAgentChat({
  chatId,
  mainChatId,
  place,
  narrow,
  canKeepBeside,
  wantsWorkbench,
}: {
  chatId: string;
  /** The agent's current main chat, when known. */
  mainChatId: string | null;
  place: AgentChatPlace;
  /** The view shows one pane at a time. */
  narrow: boolean;
  /** The view can carry a chat beside (its URL can say so). */
  canKeepBeside: boolean;
  /** Whoever opened it asked the chat's workbench for a tool. */
  wantsWorkbench: boolean;
}): AgentChatOpening {
  if (chatId === mainChatId) return 'here';
  if (!canKeepBeside || narrow || place === 'full' || wantsWorkbench) return 'full';
  return 'beside';
}
