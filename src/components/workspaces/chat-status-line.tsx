'use client';

import { cn } from '@/lib/utils';
import { TURN_STATUS_EFFORT_LABEL, type ChatTurnStatus } from '@/lib/sessions/turn-status';

/**
 * A chat's status line under its title (docs/chat-status-lines.md): what
 * its agent said at the end of its turn about where it stands. One that
 * waits on the person reads stronger and leads with the size of their part
 * in the rail's amber ("Quick · Pick A or B"), so a scan sorts the quick
 * answers from the ones that need time. Nothing without a status: the row
 * keeps its usual line.
 */
export function ChatStatusLine({ status, className }: { status: ChatTurnStatus | null | undefined; className?: string }) {
  if (!status) return null;
  return (
    <span
      data-chat-status={status.needsYou ? 'needs-you' : 'fyi'}
      className={cn(
        'block min-w-0 truncate text-[10px] leading-tight',
        status.needsYou ? 'text-foreground/85' : 'text-muted-foreground/70',
        className,
      )}
    >
      {status.needsYou && status.effort && (
        <span className="font-medium text-amber-600 dark:text-amber-400">{TURN_STATUS_EFFORT_LABEL[status.effort]} · </span>
      )}
      {status.line}
    </span>
  );
}
