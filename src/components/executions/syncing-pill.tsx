'use client';

import { Loader2 } from 'lucide-react';

/**
 * Thin bar above the transcript that surfaces "we're catching the
 * chat_events table up to the on-disk Claude transcript." Renders only
 * while reconciliation is in flight AND drift was detected — most
 * session opens are a no-op on the server side and this never shows.
 *
 * Composer stays enabled the whole time; the indicator is purely
 * informational. Replayed events flow into the transcript as they
 * land, so the user sees the catch-up happen.
 */
export function SyncingPill() {
  return (
    <div className="border-b border-border bg-sky-500/5 px-5 py-2">
      <div className="max-w-3xl mx-auto flex items-center gap-2 text-[11px] text-muted-foreground">
        <Loader2 size={11} className="animate-spin text-sky-500/80 flex-shrink-0" />
        <span>
          <span className="font-medium text-foreground/80">Syncing transcript</span>
          <span className="text-muted-foreground/80"> — catching up on missed events</span>
        </span>
      </div>
    </div>
  );
}
