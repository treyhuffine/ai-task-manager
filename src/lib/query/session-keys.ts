import type { QueryClient } from '@tanstack/react-query';

/** Chat caches are scoped to their document's Home and stable conversation ID. */
export const sessionKey = (id: string | null) => ['session', id] as const;
export const mainChatKey = (scope: string | null) => scope === null ? ['orchestrator-chat'] as const : ['agent-chat', scope] as const;

/**
 * Refetch a chat's row, and with an execution id its sibling chats' rows,
 * which share the execution's name and archive. Only the rows: the
 * transcripts under them arrive over their own streams.
 */
export function invalidateChatRows(client: QueryClient, sessionId: string, executionId?: string | null): void {
  void client.invalidateQueries({ predicate: (query) => {
    if (query.queryKey[0] !== 'session' || query.queryKey.length !== 2) return false;
    return query.queryKey[1] === sessionId || (!!executionId
      && (query.state.data as { executionId?: string | null } | undefined)?.executionId === executionId);
  } });
}
