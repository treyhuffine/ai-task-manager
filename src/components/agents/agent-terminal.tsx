'use client';

import { ExecutionTerminalPanel } from '@/components/executions/execution-terminal-panel';
import { workspaceFolder } from '@/lib/folders/source';
import type { WorkspaceRecord } from '@/db/types';

/**
 * Shells in the agent's own folder (docs/agents-view-spec.md Phase 7): the
 * execution view's terminal panel, pointed at the workspace. For a git agent
 * that is the source checkout. These shells belong to the agent, separate
 * from every execution's, and archiving the agent closes them.
 */
export function AgentTerminal({ workspace }: { workspace: WorkspaceRecord }) {
  const archived = workspace.status === 'archived';
  return (
    <div className="flex-1 min-h-0">
      <ExecutionTerminalPanel
        source={workspaceFolder(workspace.id)}
        disabled={archived}
        disabledReason="This agent is archived, so it has no terminal."
      />
    </div>
  );
}
