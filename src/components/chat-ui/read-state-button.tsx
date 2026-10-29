'use client';

import { EyeOff } from 'lucide-react';
import { Tip } from '@/components/ui/tip';
import { useSession } from '@/hooks/use-execution';
import { useMarkSessionRead, useMarkSessionUnread } from '@/hooks/use-workspaces';
import { isSessionUnread } from '@/lib/utils/session-sort';
import { cn } from '@/lib/utils';

/**
 * Mark unread, where you're reading. Opening a chat reads it, so this is the
 * way back to it: marked unread, it stays lit (bold with a dot in the rail,
 * counted in the header's Unread) until you open it again. Marked, the button
 * says Unread in the rail's amber, and a click marks it read.
 *
 * Reads and writes the chat's own read state (`unread_marker_at`, the same
 * one the rail's Mark as unread sets), through the optimistic hooks, so the
 * rail and this button agree at once. Nothing for an archived chat.
 */
export function ReadStateButton({ sessionId, className }: { sessionId: string | null; className?: string }) {
  const { data: chat } = useSession(sessionId);
  const markRead = useMarkSessionRead();
  const markUnread = useMarkSessionUnread();
  if (!chat || chat.status !== 'active') return null;

  if (isSessionUnread(chat)) {
    return (
      <Tip label="Mark read">
        <button
          type="button"
          onClick={() => markRead.mutate(chat.id)}
          aria-label="Unread, mark read"
          className={cn(
            'flex flex-shrink-0 items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-400',
            className,
          )}
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Unread
        </button>
      </Tip>
    );
  }

  return (
    <Tip label="Mark unread to come back to it. It stays lit until you open it again.">
      <button
        type="button"
        onClick={() => markUnread.mutate(chat.id)}
        aria-label="Mark unread"
        className={cn(
          'flex-shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground',
          className,
        )}
      >
        <EyeOff size={13} />
      </button>
    </Tip>
  );
}
