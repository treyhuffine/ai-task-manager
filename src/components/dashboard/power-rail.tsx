"use client";

import { WorkspaceNav } from '@/components/workspaces/workspace-nav';

export function PowerRail() {
  return (
    <aside className="w-[256px] border-r border-border flex flex-col bg-background z-30 transition-all">
      <nav className="flex-1 px-1 pt-2 pb-4 overflow-y-auto">
        <WorkspaceNav />
      </nav>
    </aside>
  );
}
