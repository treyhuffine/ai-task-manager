'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { archiveAnywayDialog } from '@/components/executions/uncommitted-files';
import { requestWorkbenchView } from '@/components/executions/workbench/view-request';
import { useDashboard } from '@/contexts/dashboard-context';
import { dirtyWorktreeOf, useArchiveSession } from '@/hooks/use-workspaces';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface ArchiveExecutionArgs {
  id: string;
  /** Display label for the dialog, if one is needed. Falls back to the server's. */
  label: string | null | undefined;
  /** Runs once the execution is actually archived (either pass). */
  onArchived?: () => void;
}

/**
 * Open a chat's execution on its Changes view: what Review does in the
 * archive dialog, so the person lands on the files at stake.
 */
export function useReviewChanges() {
  const { openExecution } = useDashboard();
  return useCallback(
    (sessionId: string) => {
      requestWorkbenchView(sessionId, 'changes');
      openExecution(sessionId);
    },
    [openExecution],
  );
}

/**
 * The one archive-an-execution flow, shared by every surface that offers
 * it (rail kebab, rail quick action, execution header, action bar):
 *
 *   1. Archive right away. Archiving is undone from History, and a clean
 *      worktree (committed work, pushed or not) loses nothing, so there's
 *      nothing to ask. The row vanishes at once ({@link useArchiveSession}
 *      is optimistic).
 *   2. Only when the worktree has files that aren't committed does the
 *      server refuse, naming them. The dialog lists those files and offers
 *      Review changes (opens the execution on Changes), Cancel, or Archive
 *      anyway, which force-removes the worktree.
 *   3. Any other failure is a toast.
 *
 * Returns `archive` (resolves `true` when the execution ended up archived,
 * `false` if the person kept it or it failed) plus the mutation's
 * `isPending` for driving button spinners.
 */
export function useArchiveExecution() {
  const { mutateAsync, isPending } = useArchiveSession();
  const confirm = useConfirm();
  const review = useReviewChanges();

  const archive = useCallback(
    async ({ id, label, onArchived }: ArchiveExecutionArgs): Promise<boolean> => {
      try {
        await mutateAsync({ id, force: false });
        onArchived?.();
        return true;
      } catch (err) {
        const dirty = dirtyWorktreeOf(err);
        if (!dirty) {
          toast.error("Couldn't archive execution", { description: errorMessage(err) });
          return false;
        }
        const force = await confirm(
          archiveAnywayDialog([{ id, label: label?.trim() || dirty.label, files: dirty.files, omitted: dirty.omitted }], review),
        );
        if (!force) return false;
        try {
          await mutateAsync({ id, force: true });
          onArchived?.();
          return true;
        } catch (err2) {
          toast.error("Couldn't archive execution", { description: errorMessage(err2) });
          return false;
        }
      }
    },
    [mutateAsync, confirm, review],
  );

  return { archive, isPending };
}
