'use client';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { connectedContextGroups, connectedContextVersion, globalContextViewId, setConnectedContextAccess, subscribeConnectedContext } from '@/lib/client/mcp-app-context';
import { trpc } from '@/lib/trpc/client';

/**
 * What connected apps attached to a chat's next message, one group per app,
 * kept current as views update or remove their context. A global screen's
 * context shows (and goes with a send) only once the home says this chat may
 * use its account.
 */
export function useConnectedContextGroups(chatId: string | null) {
  const version = useSyncExternalStore(subscribeConnectedContext, connectedContextVersion, () => 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is the store's change signal.
  const globalViewId = useMemo(() => globalContextViewId(), [version]);
  const access = useQuery({
    ...trpc.connectedApps.contextAccess.queryOptions({ chatId: chatId ?? '', viewIds: globalViewId ? [globalViewId] : [] }, { staleTime: 15_000 }),
    enabled: !!chatId && !!globalViewId,
  });
  useEffect(() => { if (chatId && access.data) setConnectedContextAccess(chatId, access.data); }, [chatId, access.data]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is the store's change signal.
  return useMemo(() => connectedContextGroups(chatId), [chatId, version]);
}
