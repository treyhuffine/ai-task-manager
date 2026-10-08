'use client';

/**
 * The heartbeat on the deck. It appears only when the heartbeat needs the
 * user (never set up, paused by the app, failed, or left an unread report),
 * as a chip in the deck's status row next to "in progress" and "to triage".
 * A healthy heartbeat is silent on the deck; its home is Settings > Heartbeat.
 * Tapping the chip opens those same settings in a sheet. The rule for when it
 * shows is `heartbeatDeckSignal` (src/lib/heartbeat/status.ts).
 */

import { useState } from 'react';
import { HeartPulse } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useHeartbeat } from '@/hooks/use-heartbeat';
import {
  describeHeartbeat,
  heartbeatDeckSignal,
  type HeartbeatDeckSignal,
  type HeartbeatDeckSignalKind,
} from '@/lib/heartbeat/status';
import { cn } from '@/lib/utils';
import { HeartbeatSettings } from './heartbeat-settings';
import { Tip } from '@/components/ui/tip';

const KIND_CLASS: Record<HeartbeatDeckSignalKind, string> = {
  setup: 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
  paused: 'border-amber-500/30 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400',
  failed: 'border-destructive/30 text-destructive hover:bg-destructive/10',
  report: 'border-primary/30 text-primary hover:bg-primary/10',
};

/** The deck signal for the current heartbeat, or null when it should stay quiet. */
export function useHeartbeatDeckSignal(): HeartbeatDeckSignal | null {
  const { data: config } = useHeartbeat();
  return config ? heartbeatDeckSignal(config) : null;
}

export function HeartbeatChip() {
  const { data: config } = useHeartbeat();
  const [open, setOpen] = useState(false);
  if (!config) return null;

  const signal = heartbeatDeckSignal(config);
  if (!signal) return null;

  const { detail } = describeHeartbeat(config);
  return (
    <>
      <Tip label={detail}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`${signal.label}. ${detail}`}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
            KIND_CLASS[signal.kind],
          )}
        >
          <span className="relative flex shrink-0">
            <HeartPulse size={12} />
            {signal.kind === 'report' && (
              <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
            )}
          </span>
          {signal.label}
        </button>
      </Tip>
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
