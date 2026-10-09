'use client';

import { useState } from 'react';
import { Bot, Plus } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspaces, useReorderWorkspaces } from '@/hooks/use-workspaces';
import { cn } from '@/lib/utils';
import type { WorkspaceWithCounts } from '@/db/types';
import { NeedsReviewSection } from './needs-review-section';
import { WorkspaceRow } from './workspace-row';
import { AgentRailRow } from './agent-rail-row';
import { useRailStyle } from '@/lib/client/rail-style';
import { openWorkspaceCreate } from './workspace-create-store';
import { startExecution } from '@/lib/executions/start-execution';
import { useDashboard } from '@/contexts/dashboard-context';
import { useWorkspaceSelection } from './workspace-selection-context';
import { openLauncher } from './launcher/launcher-store';
import { executionView } from '@/lib/client/active-view';

/**
 * The workspace tree in the left rail: the Needs Review surface, then the
 * agents with their executions (DnD reorder). Its header (the Agents |
 * Recent switch, select-to-archive, New agent) is the rail list's header
 * (`rail-list.tsx`), and the archive selection it drives arrives through
 * `WorkspaceSelectionProvider`, which the rail provides above both.
 */
export function WorkspaceNav() {
  const { data: workspaces, isLoading } = useWorkspaces({ status: 'active' });
  // Agents first, or the classic rows (docs/rail-agents-first.md).
  const { style: railStyle } = useRailStyle();
  const reorder = useReorderWorkspaces();
  const qc = useQueryClient();

  const { setActiveView, openAgent } = useDashboard();
  // Session row menus open the agent's setup: its view, on the Setup tab.
  const openSetup = (id: string) => openAgent(id, 'setup');
  // Guards double-fire only. Navigation no longer waits on the create, so
  // without this a fast second click would quietly make a second execution.
  const [creating, setCreating] = useState(false);

  // Bulk-archive selection state, shared with the session rows (which
  // render the checkboxes) and the rail's list header (which toggles it).
  const selecting = useWorkspaceSelection()?.selecting ?? false;

  // Shift-click on the ➕ — "just make one, skip the modal". Navigates on
  // the spot and lets the create finish behind the view; the point of this
  // shortcut is speed, so waiting out a round-trip would defeat it. The label
  // is null on the new row and gets derived server-side from the first
  // message; until then the SetupCard and header render "Untitled".
  const handleCreateExecution = (workspaceId: string) => {
    if (creating) return;
    setCreating(true);
    const { sessionId, done } = startExecution(qc, { workspaceId });
    setActiveView(executionView(sessionId));
    void done.finally(() => setCreating(false));
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !workspaces) return;

    const oldIndex = workspaces.findIndex((w) => w.id === active.id);
    const newIndex = workspaces.findIndex((w) => w.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(workspaces, oldIndex, newIndex);
    // Optimistic update so the row settles into place without flash.
    qc.setQueryData<WorkspaceWithCounts[]>(['workspaces', { status: 'active' }], next);
    reorder.mutate(next.map((w) => w.id));
  };

  return (
    <div className="flex flex-col">
      {/* The needs-review triage surface duplicates tree rows; hide it
          while selecting so a session never shows two checkboxes (or a
          checkbox up top and a plain row below). */}
      {!selecting && <NeedsReviewSection />}

      <div className={cn('px-1', railStyle === 'agents' ? 'space-y-1' : 'space-y-0.5')}>
        {isLoading && (
          <div className="flex flex-col gap-1 pt-1">
            <WorkspaceHeaderSkeleton />
            <WorkspaceHeaderSkeleton />
            <WorkspaceHeaderSkeleton />
          </div>
        )}
        {!isLoading && (workspaces?.length ?? 0) === 0 && <EmptyState onCreate={openWorkspaceCreate} />}
        {workspaces && workspaces.length > 0 && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={workspaces.map((w) => w.id)} strategy={verticalListSortingStrategy}>
              {workspaces.map((ws) =>
                railStyle === 'agents' ? (
                  <AgentRailRow
                    key={ws.id}
                    workspace={ws}
                    onOpenSettings={openSetup}
                    onCreateExecution={handleCreateExecution}
                    onOpenLauncher={openLauncher}
                  />
                ) : (
                  <WorkspaceRow
                    key={ws.id}
                    workspace={ws}
                    onOpenSettings={openSetup}
                    onCreateExecution={handleCreateExecution}
                    onOpenLauncher={openLauncher}
                  />
                ),
              )}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}

function WorkspaceHeaderSkeleton() {
  return (
    <div className="flex items-center gap-1.5 px-1 py-1">
      <div className="w-5 h-5 rounded bg-muted/60 animate-pulse flex-shrink-0" />
      <div className="h-2.5 w-1/2 rounded bg-muted/60 animate-pulse" />
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="px-3 py-4 text-center">
      <Bot size={20} className="mx-auto text-muted-foreground/40 mb-2" />
      <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
        No agents yet. Add one to get started.
      </p>
      <button
        onClick={onCreate}
        className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium text-primary hover:bg-primary/10 transition-colors"
      >
        <Plus size={11} /> New agent
      </button>
    </div>
  );
}
