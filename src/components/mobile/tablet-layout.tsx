"use client";

import { useDashboard } from '@/contexts/dashboard-context';
import { useOrchestratorName } from '@/hooks/use-user-state';
import { OrchestratorAvatar } from '@/components/shared/orchestrator-mark';
import { useRailSessions, useWorkspaces } from '@/hooks/use-workspaces';
import { useInactivity } from '@/hooks/use-inactivity';
import { ContentPanel } from '@/components/dashboard/content-panel';
import { ExecutionView } from '@/components/executions/execution-view';
import { AgentView } from '@/components/agents/agent-view';
import { SkillView } from '@/components/skills/skill-view';
import { AgentIcon } from '@/components/agents/agent-icon';
import { classifySession } from '@/components/workspaces/bucket-config';
import { useAgentAttention } from '@/hooks/use-agent-attention';
import { cn } from '@/lib/utils';

/**
 * Tablet layout (768–1024px): a compact rail of agents on the left and one
 * main surface, Home, an agent's view, or an execution, whichever is
 * active. The agent view measures itself, so at these widths it shows one
 * pane at a time with a Chat / Tools switch (docs/agents-view-spec.md
 * Phase 9).
 */
export function TabletLayout() {
  const { theme, activeView, goHome, openAgent, pendingInputSessionIds, streamingSessionIds } = useDashboard();
  const { data: workspaces } = useWorkspaces({ status: 'active' });
  const { data: rail } = useRailSessions();
  const { isInactive } = useInactivity();
  const isDark = theme === 'dark';
  const orchestratorName = useOrchestratorName();

  // One amber dot per agent that wants you: the agent itself (its main chat
  // is waiting on you or replied) or any of its work, the rail's rule.
  // Inactive work is folded in the rail, so it doesn't light a dot here.
  const agentsWanting = useAgentAttention();
  const needsYou = new Set([
    ...agentsWanting.map((a) => a.workspace.id),
    ...(rail?.sessions ?? [])
      .filter((s) => s.status === 'active' && s.workspaceId && !isInactive(s))
      .filter((s) => {
        const bucket = classifySession(s, pendingInputSessionIds, streamingSessionIds);
        return bucket === 'needsApproval' || bucket === 'unread';
      })
      .map((s) => s.workspaceId!),
  ]);

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <aside className="w-[60px] border-r border-border flex flex-col items-center bg-background z-30 py-3 gap-1">
        {/* Home is the orchestrator's, so it wears its initial, as in the
            desktop rail. */}
        <button
          onClick={goHome}
          title={`${orchestratorName} (Home)`}
          aria-label={`${orchestratorName}, home`}
          aria-current={activeView.kind === 'home' ? 'page' : undefined}
          className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center transition-all',
            activeView.kind === 'home'
              ? 'bg-primary/10 ring-1 ring-primary/30'
              : isDark ? 'bg-secondary hover:bg-secondary/80' : 'bg-muted hover:bg-muted/80',
          )}
        >
          <OrchestratorAvatar size="md" />
        </button>

        <div className="w-6 h-px bg-border my-2" />

        <div className="flex flex-col items-center gap-1 flex-1 overflow-y-auto">
          {(workspaces ?? []).map((ws) => {
            const active = activeView.kind === 'agent' && activeView.id === ws.id;
            return (
              <button
                key={ws.id}
                onClick={() => openAgent(ws.id)}
                title={ws.name}
                aria-label={ws.name}
                className={cn(
                  'w-10 h-10 rounded-xl flex items-center justify-center relative transition-all',
                  active ? 'ring-1 ring-primary/30 bg-primary/5' : isDark ? 'bg-secondary hover:bg-secondary/80' : 'bg-muted hover:bg-muted/80',
                )}
              >
                <AgentIcon workspace={ws} size="sm" />
                {needsYou.has(ws.id) && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-background" />
                )}
              </button>
            );
          })}
        </div>
      </aside>

      <div className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
        {activeView.kind === 'execution' ? (
          <ExecutionView sessionId={activeView.id} />
        ) : activeView.kind === 'agent' ? (
          <AgentView workspaceId={activeView.id} tab={activeView.tab} />
        ) : activeView.kind === 'skill' ? (
          <SkillView skillRef={activeView.ref} />
        ) : (
          <ContentPanel panelId="a" />
        )}
      </div>
    </div>
  );
}
