"use client";

import { Zap, Activity } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { ContentPanel } from '@/components/dashboard/content-panel';
import { cn } from '@/lib/utils';
import { HOME_VIEW, agentView } from '@/lib/client/active-view';

/**
 * Tablet layout (768–1024px): compact agent rail on left + single content panel.
 * The rail is narrower than the desktop PowerRail (~56px, icon-only) with
 * tooltips/labels below each icon.
 */
export function TabletLayout() {
  const { theme, activeView, setActiveView, agents } = useDashboard();
  const isDark = theme === 'dark';

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Compact agent rail */}
      <aside className="w-[60px] border-r border-border flex flex-col items-center bg-background z-30 py-3 gap-1">
        {/* Command */}
        <button
          onClick={() => setActiveView(HOME_VIEW)}
          title="Command"
          className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center transition-all',
            activeView.kind === 'home'
              ? 'bg-primary/10 text-primary ring-1 ring-primary/30'
              : isDark ? 'bg-secondary text-muted-foreground hover:text-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
          )}
        >
          <Zap size={16} className={activeView.kind === 'home' ? 'fill-primary' : ''} />
        </button>

        {/* Divider */}
        <div className="w-6 h-px bg-border my-2" />

        <div className="flex flex-col items-center gap-1 flex-1 overflow-y-auto">
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => setActiveView(agentView(agent.id))}
              title={`${agent.name}${agent.task ? `: ${agent.task}` : ''}`}
              className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center text-base relative transition-all',
                activeView.kind === 'agent' && activeView.id === agent.id
                  ? 'ring-1 ring-primary/30 bg-primary/5'
                  : isDark ? 'bg-secondary hover:bg-secondary/80' : 'bg-muted hover:bg-muted/80',
                agent.status !== 'active' && !(activeView.kind === 'agent' && activeView.id === agent.id) && 'opacity-50'
              )}
            >
              {agent.icon}
              {agent.status === 'active' && (
                <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-background" />
              )}
            </button>
          ))}
        </div>

        {/* Agent count */}
        <div className="mt-auto pt-2">
          <Activity size={12} className="text-muted-foreground" />
        </div>
      </aside>

      {/* Single content panel with full tab bar */}
      <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
        <ContentPanel panelId="a" />
      </div>
    </div>
  );
}
