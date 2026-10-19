'use client';
import { useMemo, useSyncExternalStore } from 'react';
import { connectedContextGroups, connectedContextVersion, subscribeConnectedContext } from '@/lib/client/mcp-app-context';

/**
 * What connected apps attached to a chat's next message, one group per app,
 * kept current as views update or remove their context.
 */
export function useConnectedContextGroups(chatId: string | null) {
  const version = useSyncExternalStore(subscribeConnectedContext, connectedContextVersion, () => 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is the store's change signal.
  return useMemo(() => connectedContextGroups(chatId), [chatId, version]);
}
