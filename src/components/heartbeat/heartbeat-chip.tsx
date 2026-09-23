'use client';

/**
 * The heartbeat on the deck: one quiet chip that says how the last check-in
 * went, and opens the heartbeat's settings in a sheet. See
 * docs/heartbeat-spec.md §7.2.
 */

import { useState } from 'react';
import { HeartPulse } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useHeartbeat } from '@/hooks/use-heartbeat';
import { describeHeartbeat, type HeartbeatTone } from '@/lib/heartbeat/status';
import { cn } from '@/lib/utils';
import { HeartbeatSettings } from './heartbeat-settings';

const TONE_TEXT: Record<HeartbeatTone, string> = {
  off: 'text-muted-foreground/50 hover:text-muted-foreground',
  idle: 'text-muted-foreground/70 hover:text-muted-foreground',
  active: 'text-muted-foreground hover:text-foreground',
  attention: 'text-primary hover:text-primary/80',
  error: 'text-destructive/80 hover:text-destructive',
};

export function HeartbeatChip() {
  const { data: config } = useHeartbeat();
  const [open, setOpen] = useState(false);
  if (!config) return null;

  const status = describeHeartbeat(config);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={status.detail}
        aria-label={`Heartbeat: ${status.detail}`}
        className={cn('flex items-center gap-1.5 text-[10px] transition-colors', TONE_TEXT[status.tone])}
      >
        <span className="relative flex">
          <HeartPulse className={cn('h-3 w-3', status.tone === 'active' && 'animate-pulse')} />
          {status.tone === 'attention' && (
            <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
          )}
        </span>
        Heartbeat · {status.chip}
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Heartbeat</SheetTitle>
            <SheetDescription>A regular check-in on your work, following your instructions.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            <HeartbeatSettings compact onNavigate={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
