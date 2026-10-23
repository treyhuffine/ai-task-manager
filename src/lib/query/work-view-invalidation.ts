import type { QueryClient } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc/client';

/** The existing workspace views and typed agent chips share mutation events. */
export function invalidateWorkspaceViews(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: ['workspaces'] });
  void client.invalidateQueries({ queryKey: trpc.workspaces.list.pathKey() });
  void client.invalidateQueries({ queryKey: trpc.homeExecutionChoices.queryKey() });
}
