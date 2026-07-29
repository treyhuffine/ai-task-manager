'use client';

import { useState } from 'react';
import { Plus, Folder, FolderPlus, Archive, X } from 'lucide-react';
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
import { toast } from 'sonner';
import { useWorkspaces, useReorderWorkspaces } from '@/hooks/use-workspaces';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import type { WorkspaceWithCounts } from '@/db/types';
import { NeedsReviewSection } from './needs-review-section';
import { WorkspaceRow } from './workspace-row';
import { WorkspaceCreateModal } from './workspace-create-modal';
import { WorkspaceSettingsSheet } from './workspace-settings-sheet';
import { useBulkArchiveSessions } from '@/hooks/use-workspaces';
import { startExecution } from '@/lib/executions/start-execution';
import { useDashboard } from '@/contexts/dashboard-context';
import {
  WorkspaceSelectionProvider,
  useWorkspaceSelection,
} from './workspace-selection-context';
import { openLauncher } from './launcher/launcher-store';

/**
 * Top-level container for the workspace tree in the left rail. Owns the
 * Needs Review surface, the workspace list (with DnD reorder), and the
 * settings/create modals so the rail itself stays stateless.
 *
 * Wraps the tree in {@link WorkspaceSelectionProvider} so the header's
 * archive toolbar and the per-row checkboxes share one selection state.
 */
export function WorkspaceNav() {
  return (
    <WorkspaceSelectionProvider>
      <WorkspaceNavInner />
    </WorkspaceSelectionProvider>
  );
}

function WorkspaceNavInner() {
  const { data: workspaces, isLoading } = useWorkspaces({ status: 'active' });
  const reorder = useReorderWorkspaces();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const { setActiveView } = useDashboard();
  // Guards double-fire only. Navigation no longer waits on the create, so
  // without this a fast second click would quietly make a second execution.
  const [creating, setCreating] = useState(false);

  // Bulk-archive selection state (shared with the session rows via the
  // surrounding provider). The header toggles in and out of selection
  // mode; the rows render the checkboxes.
  const selection = useWorkspaceSelection()!;
  const { selecting, count, selectedIds, enter, exit } = selection;
  const bulkArchive = useBulkArchiveSessions();
  const confirm = useConfirm();

  const handleConfirmArchive = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0 || bulkArchive.isPending) return;

    // First pass: archive everything that's clean. Dirty worktrees come
    // back unforced so we can confirm the data loss before discarding.
    const result = await bulkArchive.mutateAsync({ ids, force: false });

    if (result.dirty.length > 0) {
      const n = result.dirty.length;
      const ok = await confirm({
        title: 'Discard uncommitted changes?',
        description: `${n} of the selected execution${n === 1 ? ' has' : 's have'} uncommitted or unpushed work. Archiving removes those worktrees from disk, which permanently deletes any changes that haven't been committed. Committed work stays on each branch.`,
        confirmLabel: `Archive and discard ${n}`,
        tone: 'destructive',
      });
      if (ok) {
        const forced = await bulkArchive.mutateAsync({ ids: result.dirty, force: true });
        result.failed.push(...forced.failed);
      }
    }

    if (result.failed.length > 0) {
      const n = result.failed.length;
      toast.error(`Couldn't archive ${n} execution${n === 1 ? '' : 's'}`, {
        description: result.failed.map((f) => f.message).join('\n'),
      });
    }

    exit();
  };

  // Shift-click on the ➕ — "just make one, skip the modal". Navigates on
  // the spot and lets the create finish behind the view; the point of this
  // shortcut is speed, so waiting out a round-trip would defeat it. The label
  // is null on the new row and gets derived server-side from the first
  // message; until then the SetupCard and header render "Untitled".
  const handleCreateExecution = (workspaceId: string) => {
    if (creating) return;
    setCreating(true);
    const { sessionId, done } = startExecution(qc, { workspaceId });
    setActiveView(sessionId);
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
    <div
      className={cn(
        'flex flex-col',
        // The rail's scroll container has its own `pt-1`, which sits ABOVE
        // this nav — out of reach of the sticky header below (whose
        // containing block is this div). Left as-is, scrolling rows peek
        // through that 4px strip between the tabs and the pinned toolbar.
        // While selecting, cancel that padding so the nav (and the sticky
        // header's pin point) sits flush under the tabs with no gap.
        selecting && '-mt-1',
      )}
    >
      {/* The needs-review triage surface duplicates tree rows; hide it
          while selecting so a session never shows two checkboxes (or a
          checkbox up top and a plain row below). */}
      {!selecting && <NeedsReviewSection />}

      <div
        className={cn(
          'px-1 pt-1 pb-1.5',
          // While selecting, pin the Archive/Cancel toolbar to the top of
          // the rail's scroll area so it stays reachable no matter how far
          // the user scrolls the workspace tree. Solid bg + border so rows
          // scroll cleanly underneath it.
          selecting && 'sticky top-0 z-20 bg-background border-b border-border/60',
        )}
      >
        <div className="flex items-center justify-between gap-2 px-1.5 min-h-[22px]">
          {selecting ? (
            <>
              <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
                {count} selected
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleConfirmArchive}
                  disabled={count === 0 || bulkArchive.isPending}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary text-primary-foreground text-[10px] font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                >
                  <Archive size={11} />
                  Archive
                </button>
                <button
                  onClick={() => exit()}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <X size={11} />
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="text-[8.5px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
                Workspaces
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={enter}
                  className="p-1 rounded text-muted-foreground/70 hover:text-foreground hover:bg-muted/50 transition-colors"
                  aria-label="Select executions to archive"
                  title="Select executions to archive"
                >
                  <Archive size={12} />
                </button>
                <button
                  onClick={() => setCreateOpen(true)}
                  className="p-1 rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                  aria-label="New workspace"
                  title="New workspace"
                >
                  <FolderPlus size={12} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="px-1 space-y-0.5">
        {isLoading && (
          <div className="flex flex-col gap-1 pt-1">
            <WorkspaceHeaderSkeleton />
            <WorkspaceHeaderSkeleton />
            <WorkspaceHeaderSkeleton />
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
                  onOpenLauncher={openLauncher}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      <WorkspaceCreateModal open={createOpen} onOpenChange={setCreateOpen} />
      <WorkspaceSettingsSheet workspaceId={settingsId} onClose={() => setSettingsId(null)} />
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
