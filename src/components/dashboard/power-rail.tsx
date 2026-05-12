"use client";

import { useDashboard } from '@/contexts/dashboard-context';
import { RailTabs } from '@/components/workspaces/rail-tabs';
import { cn } from '@/lib/utils';

export function PowerRail() {
  const { railCollapsed } = useDashboard();
  return (
    <aside
      className={cn(
        'border-r border-border flex flex-col bg-background z-30',
        'transition-[width] duration-200 ease-out',
        railCollapsed ? 'w-[44px]' : 'w-[256px]',
      )}
    >
      <RailTabs />
    </aside>
  );
}
