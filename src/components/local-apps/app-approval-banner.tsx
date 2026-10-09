'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { LocalAppApproval } from './app-hooks';

/**
 * An app action waiting on the person, in the attention tone the rest of
 * Ri uses for "needs you": what it wants to do, the exact input it would
 * send, and one decision. `compact` is the companion's narrower version.
 */
export function AppApprovalBanner({
  approval,
  busy,
  onDecide,
  compact = false,
}: {
  approval: LocalAppApproval;
  busy: boolean;
  onDecide: (approve: boolean) => void;
  compact?: boolean;
}) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-shrink-0 flex-wrap items-start gap-x-3 gap-y-2 border-b border-amber-500/20 bg-amber-500/10',
        compact ? 'px-3 py-2' : 'px-4 py-2.5',
      )}
    >
      <span className="mt-1.5 size-1.5 flex-shrink-0 rounded-full bg-amber-500" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-foreground">
          <span className="font-mono">{approval.actionId}</span> needs your approval
        </p>
        <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[10.5px] leading-snug text-muted-foreground">
          {JSON.stringify(approval.preview, null, 2)}
        </pre>
      </div>
      <div className="flex flex-shrink-0 items-center gap-1">
        <Button size="xs" disabled={busy} onClick={() => onDecide(true)}>
          Approve once
        </Button>
        <Button size="xs" variant="ghost" disabled={busy} onClick={() => onDecide(false)}>
          Cancel action
        </Button>
      </div>
    </div>
  );
}
