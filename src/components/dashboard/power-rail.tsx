"use client";

import { RailTabs } from '@/components/workspaces/rail-tabs';

export function PowerRail() {
  return (
    <aside className="w-[256px] border-r border-border flex flex-col bg-background z-30 transition-all">
      <RailTabs />
    </aside>
  );
}
