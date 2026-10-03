import type { QueryClient } from '@tanstack/react-query';
import { entityKeys, isEntityProcedureKey } from './entity-keys';

/**
 * Refresh task lists and their attention badges after agent activity, so the
 * board, the list and the deck follow an agent's work without a reload. Called
 * on a chat's turn starting or ending, and on a reconnect.
 *
 * An agent can move a task through MCP (in the server) or the CLI (its own
 * process, which the server never hears about). Either way it does so during
 * a turn, and the server sees every turn start and end, so those edges are
 * when to look. Changes in the middle of a long turn arrive on the board's
 * own poll (`TaskKanban`) or the next edge.
 *
 * A single task (`entityKeys.tasks.detail(id)`, carrying `body`) is left alone: a
 * background refresh never touches a document someone may have open
 * (docs/optimistic-updates.md). Coalesced, so a burst of edges across several
 * agents is one refetch.
 */
const COALESCE_MS = 1_000;
const pending = new WeakMap<QueryClient, ReturnType<typeof setTimeout>>();

/** One task with its body, as opposed to a list, counts or badges. */
export function isTaskDetailKey(key: readonly unknown[]): boolean {
  return isEntityProcedureKey(key, 'tasks', 'get');
}

export function invalidateTaskListsSoon(queryClient: QueryClient): void {
  if (pending.has(queryClient)) return;
  pending.set(
    queryClient,
    setTimeout(() => {
      pending.delete(queryClient);
      queryClient.invalidateQueries({
        queryKey: entityKeys.tasks.all,
        predicate: (q) => !isTaskDetailKey(q.queryKey),
      });
    }, COALESCE_MS),
  );
}
