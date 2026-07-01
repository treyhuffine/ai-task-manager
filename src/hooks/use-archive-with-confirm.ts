'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/client';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useArchiveSession } from '@/hooks/use-workspaces';

/** True for the archive route's 409 "worktree has uncommitted/unpushed work". */
function isDirtyWorktree(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 409 &&
    (err.body as { code?: string } | null)?.code === 'dirty_worktree'
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface ArchiveWithConfirmArgs {
  id: string;
  /** Display label for the copy; falls back to "this execution". */
  label: string | null | undefined;
  /** Runs once the execution is actually archived (either pass). */
  onArchived?: () => void;
}

/**
 * The one true archive-an-execution flow, shared by every surface that
 * offers it (rail kebab, execution header, action bar). Encapsulates:
 *
 *   1. A branded confirm describing exactly what archive does + keeps.
 *   2. The optimistic archive (row vanishes immediately via
 *      {@link useArchiveSession}).
 *   3. The dirty-worktree branch: a second, destructive-toned confirm
 *      that spells out what's permanently lost before force-removing.
 *   4. Toast on failure instead of `alert()`.
 *
 * Returns `confirmArchive` (resolves `true` when the execution ended up
 * archived, `false` if the user cancelled or it failed) plus the
 * underlying mutation's `isPending` for driving button spinners.
 */
export function useArchiveWithConfirm() {
  const { mutateAsync, isPending } = useArchiveSession();
  const confirm = useConfirm();

  const confirmArchive = useCallback(
    async ({ id, label, onArchived }: ArchiveWithConfirmArgs): Promise<boolean> => {
      const name = label?.trim() || 'this execution';

      const ok = await confirm({
        title: 'Archive execution?',
        description: `"${name}" moves to your archive. Its chat history is kept and you can bring it back anytime with Continue from History. For git workspaces the on-disk worktree is removed, but the branch and its commits stay.`,
        confirmLabel: 'Archive',
      });
      if (!ok) return false;

      try {
        await mutateAsync({ id, force: false });
        onArchived?.();
        return true;
      } catch (err) {
        if (!isDirtyWorktree(err)) {
          toast.error("Couldn't archive execution", { description: errorMessage(err) });
          return false;
        }
        // Dirty worktree: make the data loss explicit before forcing.
        const force = await confirm({
          title: 'Discard uncommitted changes?',
          description: `"${name}" has uncommitted or unpushed work in its worktree. Archiving removes the worktree from disk, which permanently deletes any changes you haven't committed. Committed work stays on the branch.`,
          confirmLabel: 'Archive and discard',
          tone: 'destructive',
        });
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
    [mutateAsync, confirm],
  );

  return { confirmArchive, isPending };
}
