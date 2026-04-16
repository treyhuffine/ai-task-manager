"use client";

import { Zap, Activity, Bot } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { cn } from '@/lib/utils';

export function MobileAgentsView() {
  const { theme, activeView, setActiveView, agents } = useDashboard();
  const isDark = theme === 'dark';

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Command / Orchestrator */}
      <div className="px-4 pt-4 pb-2">
        <button
          onClick={() => setActiveView('command')}
          className={cn(
            'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all border',
            activeView === 'command'
              ? isDark
                ? 'bg-secondary border-border text-foreground'
                : 'bg-card border-border text-foreground shadow-sm'
              : 'text-muted-foreground border-transparent hover:bg-muted/50'
          )}
        >
          <div className={cn(
            'w-10 h-10 rounded-lg flex items-center justify-center',
            activeView === 'command' ? 'bg-primary/10 text-primary' : isDark ? 'bg-secondary' : 'bg-muted'
          )}>
            <Zap size={18} className={activeView === 'command' ? 'fill-primary' : ''} />
          </div>
          <div className="text-left min-w-0">
            <p className="text-sm font-bold">Command</p>
            <p className="text-[10px] text-muted-foreground font-mono leading-none">Orchestrator</p>
          </div>
        </button>
      </div>

      {/* Active Agents header */}
      <div className="px-6 pt-4 pb-2 flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Active Agents</span>
        <Activity size={12} className="text-muted-foreground" />
      </div>

      {/* Agent cards — full-width with more detail */}
      <div className="px-4 space-y-2 pb-4">
        {agents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => setActiveView(agent.id)}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all border',
              activeView === agent.id
                ? isDark
                  ? 'bg-secondary border-border text-foreground'
                  : 'bg-card border-border text-foreground shadow-sm'
                : 'text-muted-foreground border-transparent hover:bg-muted/50'
            )}
          >
            <div className={cn(
              'w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center text-lg relative',
              isDark ? 'bg-secondary' : 'bg-muted',
              activeView === agent.id ? 'ring-1 ring-primary/30' : 'opacity-70'
            )}>
              {agent.icon}
              {agent.status === 'active' && (
                <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />
              )}
            </div>
            <div className="text-left min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold truncate">{agent.name}</p>
                {agent.progress > 0 && (
                  <span className="text-[10px] font-mono text-muted-foreground ml-2">{agent.progress}%</span>
                )}
              </div>
              {agent.task && (
                <p className="text-[11px] leading-tight text-muted-foreground truncate">{agent.task}</p>
              )}
              {agent.lastUpdate && (
                <p className="text-[10px] leading-tight text-muted-foreground/60 truncate mt-0.5">{agent.lastUpdate}</p>
              )}
            </div>

            {/* Progress bar */}
            {agent.progress > 0 && (
              <div className="w-16 h-1 rounded-full bg-muted overflow-hidden flex-shrink-0">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${agent.progress}%` }}
                />
              </div>
            )}
          </button>
        ))}

        {agents.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Bot className="w-8 h-8 mx-auto opacity-30 mb-2" />
            <p className="text-[11px]">No agents running</p>
          </div>
        )}
      </div>
    </div>
  );
}
