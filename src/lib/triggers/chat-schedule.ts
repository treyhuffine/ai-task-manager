/**
 * Scheduling from inside a chat (the Schedule button in a chat's header).
 *
 * The standard case is the same chat: each run sends the message into this
 * chat (`target_kind: "session"`), which keeps its history and picks up
 * where it left off. The switch "Start a new chat each time" makes it an
 * ordinary schedule instead: a fresh chat in the chat's agent, or a fresh
 * Ri chat for the main chat, on the chat's own provider and model.
 */

import type { ChatSessionRecord } from '@/lib/api/dto/records';
import type { CreateTriggerPayload } from '@/lib/api/triggers';
import type { CompiledTrigger } from '@/lib/scheduler/frequency';
import { isImportMirror } from '@/lib/import/mirror';

/** The message a same-chat schedule starts with. The chat can pause its own schedule. */
export const CHECK_IN_MESSAGE = 'Check on progress and keep going. When the work is done, pause this schedule.';

type ChatFields = Pick<
  ChatSessionRecord,
  'id' | 'label' | 'type' | 'status' | 'surfaceKind' | 'externalSessionId' | 'workspaceId' | 'harness' | 'model' | 'effort'
>;

/** Chats a schedule can send into: active, not a setup or review chat, not a read-only mirror. */
export function canScheduleChat(chat: ChatFields): boolean {
  if (chat.status !== 'active' || chat.type === 'content') return false;
  if (chat.surfaceKind === 'team_chat' || chat.surfaceKind === 'result_review') return false;
  return !isImportMirror(chat);
}

function shorten(text: string, max = 60): string {
  const line = text.trim().split('\n')[0]!.trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

export function chatScheduleInput(
  chat: ChatFields,
  choice: { prompt: string; freshChat: boolean; schedule: CompiledTrigger; timezone: string },
): CreateTriggerPayload {
  const { schedule } = choice;
  const prompt = choice.prompt.trim();
  const timing = {
    ...schedule,
    intervalSeconds: schedule.intervalSeconds ?? null,
    runAt: schedule.runAt ?? null,
    timezone: choice.timezone,
  };
  if (!choice.freshChat) {
    return {
      name: shorten(`Check in: ${chat.label?.trim() || 'chat'}`),
      prompt,
      targetKind: 'session',
      targetSessionId: chat.id,
      ...timing,
    };
  }
  return {
    name: shorten(prompt) || 'Scheduled chat',
    prompt,
    ...(chat.workspaceId
      ? { targetKind: 'workspace' as const, workspaceId: chat.workspaceId }
      : { targetKind: 'orchestrator' as const }),
    provider: chat.harness,
    model: chat.model ?? null,
    effort: chat.effort ?? null,
    ...timing,
  };
}
