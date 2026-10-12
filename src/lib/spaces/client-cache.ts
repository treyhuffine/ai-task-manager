import type { QueryClient } from '@tanstack/react-query';
import { entityKeys } from '@/lib/query/entity-keys';
import { trpc } from '@/lib/trpc/client';

export const teamConnectionsKey = () => trpc.spaces.list.queryKey();

/** Shared writes and membership changes affect references as well as tasks. */
export function invalidateTeamContent(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: entityKeys.tasks.all });
  void qc.invalidateQueries({ queryKey: entityKeys.notes.all });
  void qc.invalidateQueries({ queryKey: teamConnectionsKey() });
}
