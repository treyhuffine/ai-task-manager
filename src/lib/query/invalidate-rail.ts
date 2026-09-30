import type { QueryClient } from '@tanstack/react-query';

/**
 * Refresh the rail's queries: the rail, needs review, and agents with their
 * counts. Coalesced: every stream frame that changes a session asks for this,
 * often several in a burst, from each open session stream and the global one.
 * One refetch per burst is enough, and a refetch for each was a pile of
 * requests queued behind the page's streams (gate B finding).
 */
const COALESCE_MS = 250;
const pending = new WeakMap<QueryClient, ReturnType<typeof setTimeout>>();

export function invalidateRailSoon(queryClient: QueryClient, opts: { includeChatStrips?: boolean } = {}): void {
  if (opts.includeChatStrips) stripsWanted.add(queryClient);
  if (pending.has(queryClient)) return;
  pending.set(
    queryClient,
    setTimeout(() => {
      pending.delete(queryClient);
      queryClient.invalidateQueries({ queryKey: ['sessions', 'rail'] });
      queryClient.invalidateQueries({ queryKey: ['sessions', 'needs-review'] });
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      if (stripsWanted.delete(queryClient)) {
        // Execution chat-tab strips read `['execution', <id>, 'chats']` for
        // sibling unread/running dots.
        queryClient.invalidateQueries({
          predicate: (q) => q.queryKey[0] === 'execution' && q.queryKey[2] === 'chats',
        });
      }
    }, COALESCE_MS),
  );
}

const stripsWanted = new WeakSet<QueryClient>();
