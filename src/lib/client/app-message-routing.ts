'use client';
import type { QueryClient } from '@tanstack/react-query';
import { sessionsApi } from '@/lib/api/sessions';
import { apiErrorCode } from '@/lib/api/client';
import { executionView } from '@/lib/client/active-view';
import { createMainChat, mainChatKey, switchToMainChat } from '@/hooks/use-main-chat';
import { trpcClient } from '@/lib/trpc/client';
import type { useOptionalDashboard } from '@/contexts/dashboard-context';
import type { MessageRouting, RoutedSession } from './app-message';

type Dashboard = ReturnType<typeof useOptionalDashboard>;

/**
 * The live implementation of `MessageRouting`: the person's chats through the
 * query cache and tRPC, and the dashboard to show a new chat in an execution.
 * Nothing else moves on screen: the view's notice says where the draft is.
 */
export function appMessageRouting(queryClient: QueryClient, dashboard: Dashboard): MessageRouting {
  return {
    async session(chatId) {
      const session = await queryClient.fetchQuery({ queryKey: ['session', chatId], queryFn: () => sessionsApi.get(chatId), staleTime: 30_000 });
      if (!session) return null;
      const { id, type, workspaceId } = session as { id: string; type: RoutedSession['type']; workspaceId?: string | null };
      return { id, type, workspaceId: workspaceId ?? null };
    },
    async mainChat() {
      const main = await queryClient.fetchQuery({ queryKey: mainChatKey(null), queryFn: () => trpcClient.orchestratorChat.list.query({}), staleTime: 30_000 });
      return main.session.id;
    },
    async newMainChat(scope) {
      let created: Awaited<ReturnType<typeof createMainChat>>;
      // The home keeps a chat nobody has written in, and refuses one the person has written in (`forApp`).
      try { created = await createMainChat(scope, { forApp: true }); }
      catch (error) { if (apiErrorCode(error) === 'main_chat_in_use') return null; throw error; }
      await switchToMainChat(queryClient, scope, created);
      return created.session.id;
    },
    async newExecutionChat(sessionId) {
      const created = await sessionsApi.newChat(sessionId, { forApp: true });
      queryClient.setQueryData(['session', created.session.id], created.session);
      void queryClient.invalidateQueries({ queryKey: ['sessions', 'rail'] });
      void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'execution' && query.queryKey[2] === 'chats' });
      dashboard?.setActiveView(executionView(created.session.id));
      return created.session.id;
    },
  };
}
