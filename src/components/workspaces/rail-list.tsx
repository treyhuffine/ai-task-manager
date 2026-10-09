'use client';

import type { ReactNode } from 'react';
import { Archive, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import type { RailTab } from '@/lib/client/rail-tab';
import { useBulkArchiveSessions } from '@/hooks/use-workspaces';
import { useReviewChanges } from '@/hooks/use-archive-execution';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { archiveAnywayDialog } from '@/components/executions/uncommitted-files';
import { cn } from '@/lib/utils';
import { Tip } from '@/components/ui/tip';
import { WorkspaceNav } from './workspace-nav';
import { HistoryView } from './history-view';
import { PinnedRail } from './pinned-rail';
import { WorkspaceCreateModal } from './workspace-create-modal';
import { openWorkspaceCreate, setWorkspaceCreateOpen, useWorkspaceCreateOpen } from './workspace-create-store';
import { WorkspaceSelectionBoundary, useWorkspaceSelection } from './workspace-selection-context';

/**
 * The rail's list of work, shared by the wide rail and the collapsed rail's
 * Agents flyout. One header row, then the list. Two lists, the same work
 * two ways:
 *
 *   - **Agents** (`workspace`): the agent tree, each agent with its
 *     executions. Houses the agent actions (create, setup, reorder, archive).
 *   - **Recent** (`history`): every execution, newest first in date groups,
 *     with an agent filter. The only list that shows archived work.
 *
 * Work by status lives in the header's pills, from every view, so the rail
 * doesn't repeat it.
 *
 * Both need `WorkspaceSelectionProvider` above them: the header owns the
 * archive-selection toggle and its toolbar, the tree's rows the checkboxes.
 */

/**
 * The list's header: which list, and the list's actions. Agents and Recent
 * are labels in the rail's group-label grammar (the same as Pinned and
 * Needs you below), the one in force bright, the other quiet, so the
 * switch is the list's title and not a second row of buttons. On Agents,
 * selecting executions to archive and New agent sit at the right. While
 * selecting, the toolbar (count, Archive, Cancel) takes the row.
 */
export function RailListHeader({ tab, onSelect }: { tab: RailTab; onSelect: (next: RailTab) => void }) {
  const selection = useWorkspaceSelection();
  const selecting = selection?.selecting ?? false;
  const count = selection?.count ?? 0;
  const bulkArchive = useBulkArchiveSessions();
  const confirm = useConfirm();
  const reviewChanges = useReviewChanges();
  const createOpen = useWorkspaceCreateOpen();

  const handleConfirmArchive = async () => {
    if (!selection) return;
    const ids = Array.from(selection.selectedIds);
    if (ids.length === 0 || bulkArchive.isPending) return;

    // First pass: archive everything that's clean. Worktrees with files
    // that aren't committed come back unforced, naming those files, so the
    // person sees what archiving them anyway would delete.
    const result = await bulkArchive.mutateAsync({ ids, force: false });

    if (result.dirty.length > 0) {
      const ok = await confirm(archiveAnywayDialog(result.dirty, reviewChanges));
      if (ok) {
        const forced = await bulkArchive.mutateAsync({ ids: result.dirty.map((d) => d.id), force: true });
        result.failed.push(...forced.failed);
      }
    }

    if (result.failed.length > 0) {
      const n = result.failed.length;
      toast.error(`Couldn't archive ${n} chat${n === 1 ? '' : 's'}`, {
        description: result.failed.map((f) => f.message).join('\n'),
      });
    }

    selection.exit();
  };

  return (
    <div className="flex min-h-[32px] items-center gap-2 border-y border-border/40 px-3">
      {selecting ? (
        <>
          <span className="text-[10px] font-medium tabular-nums text-muted-foreground">{count} selected</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => void handleConfirmArchive()}
            disabled={count === 0 || bulkArchive.isPending}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Archive size={11} />
            Archive
          </button>
          <button
            type="button"
            onClick={() => selection?.exit()}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <X size={11} />
            Cancel
          </button>
        </>
      ) : (
        <>
          <div role="tablist" aria-label="Rail list" className="flex items-center gap-3">
            <TabLabel active={tab === 'workspace'} onClick={() => onSelect('workspace')}>
              Agents
            </TabLabel>
            <TabLabel active={tab === 'history'} onClick={() => onSelect('history')}>
              Recent
            </TabLabel>
          </div>
          <div className="flex-1" />
          {tab === 'workspace' && selection && (
            <div className="flex items-center gap-1">
              <Tip label="Select chats to archive">
                <button
                  type="button"
                  onClick={selection.enter}
                  className="rounded p-1 text-muted-foreground/70 transition-colors hover:bg-muted/50 hover:text-foreground"
                  aria-label="Select chats to archive"
                >
                  <Archive size={12} />
                </button>
              </Tip>
              <Tip label="New agent">
                <button
                  type="button"
                  onClick={openWorkspaceCreate}
                  className="rounded bg-primary p-1 text-primary-foreground transition-opacity hover:opacity-90"
                  aria-label="New agent"
                >
                  <Plus size={12} />
                </button>
              </Tip>
            </div>
          )}
        </>
      )}
      <WorkspaceCreateModal open={createOpen} onOpenChange={setWorkspaceCreateOpen} />
    </div>
  );
}

function TabLabel({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'rounded-sm py-1.5 text-[9px] font-bold uppercase tracking-[0.15em] transition-colors',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active ? 'text-foreground' : 'text-muted-foreground/55 hover:text-muted-foreground',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Pinned executions, then the chosen list. Pins sit above both lists, so
 * the work you keep close is one glance away whichever list is open.
 * Renders nothing for pins when there are none. Pins and the Recent feed
 * duplicate the tree's rows, so they sit outside selection.
 */
export function RailListBody({ tab }: { tab: RailTab }) {
  return (
    <div className="pt-1">
      <WorkspaceSelectionBoundary>
        <PinnedRail />
      </WorkspaceSelectionBoundary>
      {tab === 'history' ? (
        <WorkspaceSelectionBoundary>
          <HistoryView />
        </WorkspaceSelectionBoundary>
      ) : (
        <WorkspaceNav />
      )}
    </div>
  );
}
