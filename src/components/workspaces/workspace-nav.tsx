'use client';

import { useState } from 'react';
import { Plus, Folder, FolderPlus } from 'lucide-react';
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
import type { WorkspaceWithCounts } from '@/db/types';
import { NeedsReviewSection } from './needs-review-section';
import { WorkspaceRow } from './workspace-row';
import { WorkspaceCreateModal } from './workspace-create-modal';
import { WorkspaceSettingsSheet } from './workspace-settings-sheet';
import { CreateFromModal } from './create-from-modal';
import { useCreateExecution } from '@/hooks/use-workspaces';
import { useDashboard } from '@/contexts/dashboard-context';

/**
 * Top-level container for the workspace tree in the left rail. Owns the
 * Needs Review surface, the workspace list (with DnD reorder), and the
 * settings/create modals so the rail itself stays stateless.
 */
export function WorkspaceNav() {
  const { data: workspaces, isLoading } = useWorkspaces({ status: 'active' });
  const reorder = useReorderWorkspaces();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [createFromId, setCreateFromId] = useState<string | null>(null);
  const createFromName = createFromId
    ? workspaces?.find((w) => w.id === createFromId)?.name ?? null
    : null;
  const { setActiveView } = useDashboard();
  const createExecution = useCreateExecution();

  const handleCreateExecution = (workspaceId: string) => {
    if (createExecution.isPending) return;
    createExecution.mutate(
      { workspaceId },
      {
        onSuccess: (session) => {
          // Drop the user straight into the new ExecutionView. The label
          // is null on this row and will be derived server-side from
          // their first message; until then, the SetupCard and header
          // render "Untitled".
          setActiveView(session.id);
        },
      },
    );
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
      <NeedsReviewSection />

      <div className="px-1 pt-1 pb-1.5">
        <div className="flex items-center justify-between px-1.5">
          <span className="text-[8.5px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
            Workspaces
          </span>
          <button
            onClick={() => setCreateOpen(true)}
            className="p-1 rounded text-muted-foreground/70 hover:text-foreground hover:bg-muted/50 transition-colors"
            aria-label="New workspace"
            title="New workspace"
          >
            <FolderPlus size={12} />
          </button>
        </div>
      </div>

      <div className="px-1 space-y-0.5">
        {isLoading && (
          <div className="px-3 py-2 text-[10px] italic text-muted-foreground/60">
            Loading…
          </div>
        )}
        {!isLoading && (workspaces?.length ?? 0) === 0 && (
          <EmptyState onCreate={() => setCreateOpen(true)} />
        )}
        {workspaces && workspaces.length > 0 && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={workspaces.map((w) => w.id)} strategy={verticalListSortingStrategy}>
              {workspaces.map((ws) => (
                <WorkspaceRow
                  key={ws.id}
                  workspace={ws}
                  onOpenSettings={setSettingsId}
                  onCreateExecution={handleCreateExecution}
                  onOpenCreateFrom={setCreateFromId}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      <WorkspaceCreateModal open={createOpen} onOpenChange={setCreateOpen} />
      <WorkspaceSettingsSheet workspaceId={settingsId} onClose={() => setSettingsId(null)} />
      <CreateFromModal
        workspaceId={createFromId}
        workspaceName={createFromName}
        onClose={() => setCreateFromId(null)}
      />
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="px-3 py-4 text-center">
      <Folder size={20} className="mx-auto text-muted-foreground/40 mb-2" />
      <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
        No workspaces yet. Add one to get started.
      </p>
      <button
        onClick={onCreate}
        className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-medium text-primary hover:bg-primary/10 transition-colors"
      >
        <FolderPlus size={11} /> New workspace
      </button>
    </div>
  );
}
