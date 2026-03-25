"use client";

import { Zap, Activity } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { cn } from '@/lib/utils';

export function PowerRail() {
  const { theme, activeView, setActiveView, agents } = useDashboard();
  const isDark = theme === 'dark';

  return (
    <aside className="w-[200px] border-r border-border flex flex-col bg-background z-30 transition-all">
      <nav className="flex-1 px-2 space-y-0.5 py-4 overflow-y-auto">
        {/* Command / Orchestrator */}
        <button
          onClick={() => setActiveView('command')}
          className={cn(
            'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-all border',
            activeView === 'command'
              ? isDark
                ? 'bg-secondary border-border text-foreground'
                : 'bg-card border-border text-foreground shadow-sm'
              : 'text-muted-foreground border-transparent hover:bg-muted/50'
          )}
        >
          <div className={cn(
            'w-8 h-8 rounded flex items-center justify-center',
            activeView === 'command' ? 'bg-primary/10 text-primary' : isDark ? 'bg-secondary' : 'bg-muted'
          )}>
            <Zap size={14} className={activeView === 'command' ? 'fill-primary' : ''} />
          </div>
          <div className="text-left min-w-0">
            <p className="text-[11.5px] font-bold">Command</p>
            <p className="text-[9px] text-muted-foreground font-mono leading-none">Orchestrator</p>
          </div>
        </button>

        {/* Active Agents header */}
        <div className="pt-4 pb-1.5 px-3 flex items-center justify-between">
          <span className="text-[8.5px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Active Agents</span>
          <Activity size={10} className="text-muted-foreground" />
        </div>

        {/* Agent list */}
        {agents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => setActiveView(agent.id)}
            className={cn(
              'w-full group flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-all border',
              activeView === agent.id
                ? isDark
                  ? 'bg-secondary border-border text-foreground'
                  : 'bg-card border-border text-foreground shadow-sm'
                : 'text-muted-foreground border-transparent hover:bg-muted/50'
            )}
          >
            <div className={cn(
              'w-8 h-8 rounded flex-shrink-0 flex items-center justify-center text-base relative',
              isDark ? 'bg-secondary' : 'bg-muted',
              activeView === agent.id ? 'ring-1 ring-primary/30' : 'opacity-60'
            )}>
              {agent.icon}
              {agent.status === 'active' && (
                <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-background" />
              )}
            </div>
            <div className="text-left min-w-0">
              <p className="text-[11.5px] font-bold truncate">{agent.name}</p>
              {agent.task && (
                <p className="text-[9px] leading-tight text-muted-foreground truncate">{agent.task}</p>
              )}
            </div>
          </button>
        ))}
      </nav>
    </aside>
  );
}
