"use client";

import type { CSSProperties } from 'react';
import { GitCommitHorizontal, MessageSquare } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDashboard } from '@/contexts/dashboard-context';
import { formatDuration, formatHours } from '@/lib/work/equivalents';
import type { WorkAgent, WorkSpan } from '@/lib/work/types';
import { cn } from '@/lib/utils';
import { agentStyle, timeLabel } from './work-style';

/**
 * One agent's stretch of work in the calendar grid: tinted in the agent's
 * color, solid where you were hands-on and dashed where the agent worked on
 * its own. Click for what happened in it.
 */
export function WorkSpanBlock({
  span,
  agent,
  style,
  roomy = false,
}: {
  span: WorkSpan;
  agent: WorkAgent | undefined;
  /** Position in the day column (top, height, left, width). */
  style: CSSProperties;
  /** Day view: room for a second line. */
  roomy?: boolean;
}) {
  const colors = agentStyle(agent?.color ?? -1);
  const withYou = span.withYouMinutes >= 1;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${agent?.name ?? 'Ri'}: ${timeLabel(span.start)} to ${timeLabel(span.end)}`}
          className={cn(
            'absolute z-10 min-h-3 overflow-hidden rounded border border-l-[3px] text-left transition-[filter] hover:brightness-110',
            !withYou && 'border-dashed',
          )}
          style={{ ...colors.block, ...style }}
        >
          <p className={cn('truncate px-1 py-0.5 leading-tight text-foreground', roomy ? 'text-[11px] font-medium' : 'text-[9px]')}>
            {agent?.emoji ? `${agent.emoji} ` : ''}
            {agent?.name ?? 'Ri'}
          </p>
          {roomy && (
            <p className="truncate px-1 text-[9px] text-muted-foreground">
              {span.chats.length} {span.chats.length === 1 ? 'chat' : 'chats'}
              {span.commits.length > 0 && ` · ${span.commits.length} ${span.commits.length === 1 ? 'commit' : 'commits'}`}
            </p>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-80 p-0">
        <WorkSpanDetails span={span} agent={agent} />
      </PopoverContent>
    </Popover>
  );
}

/** What a span holds: its numbers, its chats (open one), and its commits. */
export function WorkSpanDetails({ span, agent }: { span: WorkSpan; agent: WorkAgent | undefined }) {
  const { openExecution, openAgent } = useDashboard();
  const colors = agentStyle(agent?.color ?? -1);
  return (
    <div className="flex max-h-[26rem] flex-col">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="size-2 shrink-0 rounded-full" style={colors.dot} aria-hidden />
          <span className="truncate text-sm font-medium">{agent?.name ?? 'Ri'}</span>
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
            {timeLabel(span.start)} to {timeLabel(span.end)}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Agents {formatDuration(span.agentMinutes)}
          {span.withYouMinutes >= 1 ? ` · you ${formatDuration(span.withYouMinutes)}` : ' · on its own'}
          {span.personHours >= 0.5 && ` · about ${formatHours(span.personHours)} person-hours`}
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
              <div key={c.hash} className="flex items-start gap-2 px-3 py-1" title={`${c.lines} lines that count · ${c.hash}`}>
                <GitCommitHorizontal size={11} className="mt-0.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 text-xs leading-snug">{c.subject}</span>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground" title="About this many hours of a person's work">≈{formatHours(c.effortHours)}h</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
