'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatEventRecord } from '@/db/types';
import { ExecutionEvent } from './execution-event';
import { summarizeCounts, formatSpan, type TranscriptNode } from './transcript-grouping';

type GroupNode = Extract<TranscriptNode, { kind: 'group' }>;

/**
 * Collapsed summary of one completed turn's intermediate activity. Reads
 * like the Thinking toggle — a single dim row ("6 tool calls · 4
 * thinking") that expands to the full ordered detail. Default collapsed.
 */
export function ActivityGroup({
  node,
  sessionId,
  resultByCallId,
}: {
  node: GroupNode;
  sessionId?: string;
  resultByCallId?: Map<string, ChatEventRecord>;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeCounts(node.counts);
  const span = formatSpan(node.startedAt, node.endedAt);

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="group/grp flex w-full items-center gap-1.5 text-left text-[11px] text-muted-foreground/70 hover:text-muted-foreground transition-colors"
      >
        <ChevronRight
          size={11}
          className={cn('flex-shrink-0 transition-transform text-muted-foreground/40', expanded && 'rotate-90')}
        />
        <span className="truncate font-medium">{summary}</span>
        {span && <span className="flex-shrink-0 text-muted-foreground/45 tabular-nums">{span}</span>}
      </button>

      {expanded && (
        <div className="mt-1.5 ml-3 flex flex-col gap-2 border-l border-border/40 pl-3">
          {node.events.map((event) => (
            <ExecutionEvent
              key={event.id}
              event={event}
              sessionId={sessionId}
              resultByCallId={resultByCallId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
