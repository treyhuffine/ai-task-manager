/** Chat caches are scoped to their document's Home and stable conversation ID. */
export const sessionKey = (id: string | null) => ['session', id] as const;
export const mainChatKey = (scope: string | null) => scope === null ? ['orchestrator-chat'] as const : ['agent-chat', scope] as const;
