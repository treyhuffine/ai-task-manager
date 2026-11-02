'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { archiveAnywayDialog } from '@/components/executions/uncommitted-files';
import { requestWorkbenchView } from '@/components/executions/workbench/view-request';
import { useWorkActivity, useWorkNavigation } from '@/contexts/work-context';
import { dirtyWorktreeOf, useArchiveSession } from '@/hooks/use-workspaces';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A chat being archived, as known on the click, before the server answers. */
export interface ArchivingChat {
  /** The chat's session id. */
  id: string;
  /** Its execution, so a viewer on a sibling chat of it leaves too. */
  executionId: string | null | undefined;
  /** Its agent, where a viewer on it goes. Without one, Home. */
  workspaceId: string | null | undefined;
}

export interface ArchiveExecutionArgs extends ArchivingChat {
  /** Its name in the dialog and the error toast. The dialog falls back to the server's. */
  label: string | null | undefined;
}

/**
 * Leave the chat on screen when it's among `chats` being archived (or a
 * sibling chat of one of their executions): for its agent, or Home without
 * one, or the view's own way out (`leaveChat`). Call it on the click, before
 * the request: nothing about archiving navigates when the request settles.
 */
export function useLeaveArchivedChat() {
  const { openAgent, goHome, leaveChat } = useWorkNavigation();
  const { activeSessionId, activeExecutionId } = useWorkActivity();
  return useCallback(
    (chats: readonly ArchivingChat[]) => {
      if (!activeSessionId) return;
      const open = chats.find((c) => c.id === activeSessionId || (!!c.executionId && c.executionId === activeExecutionId));
      if (!open) return;
      if (leaveChat) leaveChat(open.workspaceId ?? null);
      else if (open.workspaceId) openAgent(open.workspaceId);
      else goHome();
    },
    [activeSessionId, activeExecutionId, leaveChat, openAgent, goHome],
  );
}

/**
 * Open a chat's execution on its Changes view: what Review does in the
 * archive dialog, so the person lands on the files at stake.
 */
export function useReviewChanges() {
  const { openExecution } = useWorkNavigation();
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
 *   3. Any other failure is a toast naming the chat.
 *   4. Archiving the execution on screen (its chat, or a sibling chat of
 *      it) leaves for its agent, or Home, on the click, before the request
 *      starts ({@link useLeaveArchivedChat}, shared with bulk archive). Removing a worktree can take a while, and the person may be
 *      somewhere else by the time it returns, so nothing navigates when it
 *      settles: the dialog and the toast show wherever they are, Cancel and
 *      a failure leave them there (the row comes back), and Archive anyway
 *      doesn't move them. Archiving another execution leaves the view in
 *      place.
 *
 * Returns `archive` (resolves `true` when the execution ended up archived,
 * `false` if the person kept it or it failed) plus the mutation's
 * `isPending` for driving button spinners.
 */
export function useArchiveExecution() {
  const { mutateAsync, isPending } = useArchiveSession();
  const confirm = useConfirm();
  const review = useReviewChanges();
  const leave = useLeaveArchivedChat();

  const archive = useCallback(
    async ({ id, executionId, workspaceId, label }: ArchiveExecutionArgs): Promise<boolean> => {
      leave([{ id, executionId, workspaceId }]);
      const name = label?.trim();
      const failed = (err: unknown) => {
        toast.error(name ? `Couldn't archive "${name}"` : "Couldn't archive the chat", { description: errorMessage(err) });
        return false;
      };
      try {
        await mutateAsync({ id, force: false });
        return true;
      } catch (err) {
        const dirty = dirtyWorktreeOf(err);
        if (!dirty) return failed(err);
        const force = await confirm(
          archiveAnywayDialog([{ id, label: name || dirty.label, files: dirty.files, omitted: dirty.omitted }], review),
        );
        if (!force) return false;
        try {
          await mutateAsync({ id, force: true });
          return true;
        } catch (err2) {
          return failed(err2);
        }
      }
    },
    [mutateAsync, confirm, review, leave],
  );

  return { archive, isPending };
}
