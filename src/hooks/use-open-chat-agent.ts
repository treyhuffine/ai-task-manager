'use client';

import { useDashboard } from '@/contexts/dashboard-context';
import { useSession } from '@/hooks/use-execution';
import { useRailSessions } from '@/hooks/use-workspaces';

/**
 * The agent whose chat is on screen, or null when no chat is. The rail marks
 * it so you can see which agent you're in (docs/rail-agents-first.md).
 *
 * The rail feed answers for live chats, a sibling chat of an execution
 * included (through `activeExecutionId`). A chat the feed doesn't list, such
 * as an archived one opened from Recent or from search, answers from its own
 * row, which the chat view loads anyway.
 */
export function useOpenChatAgentId(): string | null {
  const { activeSessionId, activeExecutionId } = useDashboard();
  const { data: rail } = useRailSessions();
  const listed = activeSessionId
    ? rail?.sessions.find(
        (s) => s.id === activeSessionId || (!!activeExecutionId && s.executionId === activeExecutionId),
      )
    : undefined;
  const { data: session } = useSession(activeSessionId && !listed ? activeSessionId : null);
  return listed?.workspaceId ?? session?.workspaceId ?? null;
}
