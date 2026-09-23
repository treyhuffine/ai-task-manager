"use client";

import { Zap } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useRailSessions, useWorkspaces } from '@/hooks/use-workspaces';
import { ContentPanel } from '@/components/dashboard/content-panel';
import { ExecutionView } from '@/components/executions/execution-view';
import { AgentView } from '@/components/agents/agent-view';
import { AgentIcon } from '@/components/agents/agent-icon';
import { classifySession } from '@/components/workspaces/bucket-config';
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
  const isDark = theme === 'dark';

  // One amber dot per agent with work waiting on the user, the rail's rule.
  const needsYou = new Set(
    (rail?.sessions ?? [])
      .filter((s) => s.status === 'active' && s.workspaceId)
      .filter((s) => {
        const bucket = classifySession(s, pendingInputSessionIds, streamingSessionIds);
        return bucket === 'needsApproval' || bucket === 'unread';
      })
      .map((s) => s.workspaceId!),
  );

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <aside className="w-[60px] border-r border-border flex flex-col items-center bg-background z-30 py-3 gap-1">
        <button
          onClick={goHome}
          title="Home"
          aria-label="Home"
          className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center transition-all',
            activeView.kind === 'home'
              ? 'bg-primary/10 text-primary ring-1 ring-primary/30'
              : isDark ? 'bg-secondary text-muted-foreground hover:text-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
          )}
        >
          <Zap size={16} className={activeView.kind === 'home' ? 'fill-primary' : ''} />
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
        ) : (
          <ContentPanel panelId="a" />
        )}
      </div>
    </div>
  );
}
