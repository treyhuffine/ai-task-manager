import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc/client';

export function useConversationAudience(sessionId: string | null) {
  return useQuery({ ...trpc.conversationIntegrations.forSession.queryOptions({ sessionId: sessionId ?? '' }), enabled: Boolean(sessionId) });
}
