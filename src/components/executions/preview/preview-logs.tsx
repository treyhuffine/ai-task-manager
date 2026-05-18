'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { AppPreviewLogLine } from '@/lib/api/workspaces';

interface PreviewLogsProps {
  lines: ReadonlyArray<AppPreviewLogLine>;
  /** When true, auto-scroll to the bottom on new lines. */
  autoScroll?: boolean;
}

export function PreviewLogs({ lines, autoScroll = true }: PreviewLogsProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);

  // Track whether the user is at the bottom of the scroll region;
  // if so, keep them pinned. If they scrolled up, leave them alone.
  useEffect(() => {
    if (!autoScroll || !scrollerRef.current) return;
    const el = scrollerRef.current;
    if (wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines, autoScroll]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    wasAtBottomRef.current = dist < 16;
  };

  if (lines.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/20 px-3 text-[11px] text-muted-foreground/70">
        Waiting for output…
      </div>
    );
  }

  return (
    <div
      ref={scrollerRef}
      onScroll={handleScroll}
      className="h-full overflow-y-auto bg-muted/10 px-2 py-1.5 font-mono text-[11px] leading-snug"
    >
      {lines.map((l) => (
        <div
          key={l.seq}
          className={cn(
            'whitespace-pre-wrap break-all',
            l.stream === 'stderr' ? 'text-red-400/90' : 'text-foreground/85',
          )}
        >
          {l.line || ' '}
        </div>
      ))}
    </div>
  );
}
