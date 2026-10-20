/**
 * How a harness hears who sent a message that another chat sent it
 * (docs/agents-view-spec.md Phase 4, "Provenance").
 *
 * When an agent's main chat or the app's main chat steers an execution with
 * `send_session_message`, the stored event keeps the message exactly as sent
 * and records `sender_session_id`. What the receiving harness is handed gets a
 * one-line label first, so it never mistakes the message for the user typing
 * and knows where a reply will be read. Messages the user types are unchanged.
 */

import { getChatSessionWithExecution, getUserState, getWorkspace } from '@/lib/db/queries';
import { DEFAULT_ORCHESTRATOR_NAME, resolveOrchestratorName } from '@/lib/orchestrator/name';

/** A short description of the sending chat, for the label. */
export function describeSender(senderSessionId: string): string {
  const sender = getChatSessionWithExecution(senderSessionId);
  if (!sender) return 'a chat that has since been deleted';
  const workspace = sender.workspaceId ? getWorkspace(sender.workspaceId) : null;
  const where = workspace ? ` in "${workspace.name}"` : '';
  switch (sender.type) {
    case 'orchestration':
      // The UI calls a workspace an agent. Its main chat is an orchestration
      // chat with a workspace. The app's main chat has none.
      if (workspace) return `the "${workspace.name}" agent's main chat`;
      return appMainChatName();
    case 'execution': {
      const label = sender.execution?.label ?? sender.label;
      return label ? `the "${label}" execution${where}` : `another execution${where}`;
    }
    default:
      return "a chat about one of the user's notes or tasks";
  }
}

/**
 * The app's main chat, by the name the user calls it once they've picked one.
 * The default name is the app's own, which would only add noise to the label.
 */
function appMainChatName(): string {
  const name = resolveOrchestratorName(getUserState()?.orchestratorName);
  const role = "the orchestrator (the user's main chat)";
  return name === DEFAULT_ORCHESTRATOR_NAME ? role : `${name}, ${role}`;
}

/** The text a harness receives: the label then the message, or the message alone. */
export function withSenderLabel(text: string, senderSessionId: string | null | undefined): string {
  if (!senderSessionId) return text;
  return `[Message from ${describeSender(senderSessionId)}, sent on the user's behalf]\n\n${text}`;
}
