import { trpcClient } from '@/lib/trpc/client';
import type { RouterOutputs } from '@/lib/trpc/router';

/**
 * Reads behind the agent view (docs/agents-view-spec.md Phase 7) that are
 * about the agent as a whole rather than one execution. The main chat, the
 * folder and terminals have their own clients (`use-main-chat.ts`,
 * `folders.ts`, `terminals.ts`).
 */

/** A preview on one of the agent's executions, with the execution's label. */
export type AgentPreview = RouterOutputs['workspaces']['previewsGet']['previews'][number];

/** An open task one or more of the agent's active executions are working. */
export type AgentTask = RouterOutputs['workspaces']['tasksGet']['tasks'][number];

export const agentsApi = {
  previews(workspaceId: string) {
    return trpcClient.workspaces.previewsGet.query({params: {id: workspaceId}});
  },

  tasks(workspaceId: string) {
    return trpcClient.workspaces.tasksGet.query({params: {id: workspaceId}});
  },
};
