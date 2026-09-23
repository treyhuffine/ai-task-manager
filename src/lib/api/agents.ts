import { api } from './client';
import type { PreviewState } from './preview';
import type { TaskRecord } from '@/db/types';

/**
 * Reads behind the agent view (docs/agents-view-spec.md Phase 7) that are
 * about the agent as a whole rather than one execution. The main chat, the
 * folder and terminals have their own clients (`use-main-chat.ts`,
 * `folders.ts`, `terminals.ts`).
 */

/** A preview on one of the agent's executions, with the execution's label. */
export type AgentPreview = PreviewState & { label: string | null };

/** An open task one or more of the agent's active executions are working. */
export interface AgentTask {
  id: string;
  title: string;
  status: TaskRecord['status'];
  executionIds: string[];
}

export const agentsApi = {
  previews(workspaceId: string): Promise<{ previews: AgentPreview[] }> {
    return api.get(`/workspaces/${workspaceId}/previews`);
  },

  tasks(workspaceId: string): Promise<{ tasks: AgentTask[] }> {
    return api.get(`/workspaces/${workspaceId}/tasks`);
  },
};
