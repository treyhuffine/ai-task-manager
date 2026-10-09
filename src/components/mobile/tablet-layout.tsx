"use client";

import { useDashboard } from '@/contexts/dashboard-context';
import { ContentPanel } from '@/components/dashboard/content-panel';
import { PowerRail } from '@/components/dashboard/power-rail';
import { ExecutionView } from '@/components/executions/execution-view';
import { AgentView } from '@/components/agents/agent-view';
import { AppsShell } from '@/components/local-apps/apps-shell';
import { SkillView } from '@/components/skills/skill-view';

/**
 * Tablet layout (768–1024px): the desktop rail, always collapsed, and one
 * main surface, Home, an agent's view, or an execution, whichever is active.
 * The rail's Agents button opens the agent tree as a flyout over the page
 * (tap it, or rest a pointer on it), so the window never gives up 256px to
 * it. The agent view measures itself, so at these widths it shows one pane
 * at a time with a Chat / Tools switch (docs/agents-view-spec.md Phase 9).
 */
export function TabletLayout() {
  const { activeView } = useDashboard();

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <PowerRail fixed />

      <div className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
        {activeView.kind === 'apps' ? (<AppsShell route={activeView.route}/>) : activeView.kind === 'execution' ? (
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
