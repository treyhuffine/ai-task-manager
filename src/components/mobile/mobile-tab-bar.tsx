"use client";

import { MessageSquare, Bot, Plus, Layers3, MoreHorizontal } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { cn } from '@/lib/utils';
import type { MobileTab } from '@/types/dashboard';

const TABS: { id: MobileTab; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'create', label: '', icon: Plus },
  { id: 'deck', label: 'Deck', icon: Layers3 },
  { id: 'more', label: 'More', icon: MoreHorizontal },
];

export function MobileTabBar() {
  const { mobileTab, setMobileTab, setMobileCreateOpen, agents } = useDashboard();
  const activeAgentCount = agents.filter(a => a.status === 'active').length;

  return (
    <nav className="flex-shrink-0 border-t border-border bg-background flex items-end justify-around px-2 pb-[env(safe-area-inset-bottom)] select-none">
      {TABS.map((tab) => {
        const isCreate = tab.id === 'create';
        const isActive = !isCreate && mobileTab === tab.id;

        if (isCreate) {
          return (
            <button
              key={tab.id}
              onClick={() => setMobileCreateOpen(true)}
              className="flex items-center justify-center -mt-3 w-12 h-12 rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30 active:scale-95 transition-transform"
            >
              <Plus size={22} strokeWidth={2.5} />
            </button>
          );
        }

        return (
          <button
            key={tab.id}
            onClick={() => setMobileTab(tab.id)}
            className={cn(
              'flex flex-col items-center gap-0.5 py-2 px-3 min-w-[56px] transition-colors relative',
              isActive ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <div className="relative">
              <tab.icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
              {tab.id === 'agents' && activeAgentCount > 0 && (
                <div className="absolute -top-1 -right-1.5 w-3.5 h-3.5 rounded-full bg-emerald-500 text-[7px] font-bold text-white flex items-center justify-center ring-2 ring-background">
                  {activeAgentCount}
                </div>
              )}
            </div>
            <span className={cn(
              'text-[9px] font-medium',
              isActive && 'font-bold'
            )}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
