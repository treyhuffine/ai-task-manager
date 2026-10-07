"use client";

import { GitCommitHorizontal, MessageSquare } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { formatDuration, formatHours } from '@/lib/work/equivalents';
import type { WorkAgent, WorkSpan } from '@/lib/work/types';
import { agentStyle, timeLabel } from './work-style';
import { Tip } from '@/components/ui/tip';

/** What a span holds: its numbers, its chats (open one), and its commits. */
export function WorkSpanDetails({ span, agent }: { span: WorkSpan; agent: WorkAgent | undefined }) {
  const { openExecution, openAgent } = useDashboard();
  const colors = agentStyle(agent?.color ?? 0);
  return (
    <div className="flex max-h-[26rem] flex-col">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="size-2 shrink-0 rounded-[2px]" style={colors.dot} aria-hidden />
          <span className="truncate text-sm font-medium">{agent?.name ?? 'Ri'}</span>
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
            {timeLabel(span.start)} to {timeLabel(span.end)}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Agent time {formatDuration(span.agentMinutes)}
          {span.withYouMinutes >= 1 ? ` · your time ${formatDuration(span.withYouMinutes)}` : ' · on its own'}
          {span.personHours >= 0.5 && ` · about ${formatHours(span.personHours)}h of human work`}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {span.chats.map((chat) => (
          <button
            key={chat.sessionId}
            type="button"
            onClick={() => (chat.executionId ? openExecution(chat.sessionId) : span.agentId ? openAgent(span.agentId) : undefined)}
            className="flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-muted/60"
          >
            <MessageSquare size={11} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-xs">{chat.label}</span>
            {chat.scheduled && <span className="shrink-0 text-[10px] text-muted-foreground">scheduled</span>}
            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{formatDuration(chat.agentMinutes)}</span>
          </button>
        ))}
        {span.commits.length > 0 && (
          <div className="mt-1 border-t border-border/60 pt-1">
            {span.commits.map((c) => (
              <Tip key={c.hash} label={`${c.lines} lines that count · ${c.hash}`}>
                <div className="flex items-start gap-2 px-3 py-1">
                  <GitCommitHorizontal size={11} className="mt-0.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 text-xs leading-snug">{c.subject}</span>
                  <Tip label="About this many hours of a person's work">
                    <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">≈{formatHours(c.effortHours)}h</span>
                  </Tip>
                </div>
              </Tip>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
