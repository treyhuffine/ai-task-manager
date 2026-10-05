"use client";

import { useState } from 'react';
import { CheckSquare, GitCommitHorizontal, MessageSquare, Archive } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { formatDayLabel } from '@/lib/calendar/dates';
import { formatDuration, formatHours } from '@/lib/work/equivalents';
import type { WorkAgent, WorkChat, WorkCommit, WorkDay, WorkRange } from '@/lib/work/types';
import { cn } from '@/lib/utils';
import { agentStyle } from './work-style';

/** Commits shown per agent per day before "Show all". */
const COMMITS_SHOWN = 6;

/**
 * The week as a list of what got done (docs/work-view.md): each day, its
 * numbers, then by agent what shipped and which chats ran without a commit,
 * then finished executions and tasks. Days with nothing are left out.
 */
export function WorkList({ range, today }: { range: WorkRange; today: string }) {
  const agents = new Map(range.agents.map((a) => [a.id, a] as const));
  const days = range.dayList.filter(
    (d) => d.spans.length || d.looseCommits.length || d.tasksDone.length || d.executionsFinished.length,
  );
  if (days.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No work this week yet.</p>;
  }
  return (
    <div className="h-full space-y-5 overflow-y-auto pb-6 pr-1">
      {days.map((day) => (
        <DaySection key={day.date} day={day} agents={agents} isToday={day.date === today} />
      ))}
    </div>
  );
}

interface AgentDay {
  agentId: string | null;
  agentMinutes: number;
  commits: WorkCommit[];
  quietChats: WorkChat[];
}

function DaySection({ day, agents, isToday }: { day: WorkDay; agents: ReadonlyMap<string | null, WorkAgent>; isToday: boolean }) {
  const { openTask, openExecution } = useDashboard();
  const s = day.stats;

  // Group the day by agent: commits from its spans (and loose ones), chats without a commit.
  const byAgent = new Map<string | null, AgentDay>();
  const entry = (id: string | null) => {
    let e = byAgent.get(id);
    if (!e) {
      e = { agentId: id, agentMinutes: 0, commits: [], quietChats: [] };
      byAgent.set(id, e);
    }
    return e;
  };
  for (const span of day.spans) {
    const e = entry(span.agentId);
    e.agentMinutes += span.agentMinutes;
    e.commits.push(...span.commits);
    if (span.commits.length === 0) {
      // A chat can run in two stretches a day: one row, its time summed.
      for (const chat of span.chats) {
        const seen = e.quietChats.find((c) => c.sessionId === chat.sessionId);
        if (seen) seen.agentMinutes += chat.agentMinutes;
        else e.quietChats.push({ ...chat });
      }
    }
  }
  for (const c of day.looseCommits) entry(c.agentId).commits.push(c);
  const groups = [...byAgent.values()].sort((a, b) => b.commits.length - a.commits.length || b.agentMinutes - a.agentMinutes);

  return (
    <section>
      <header className="sticky top-0 z-10 flex items-baseline gap-2 border-b border-border/60 bg-background pb-1.5">
        <h3 className={cn('text-sm font-medium', isToday && 'text-primary')}>{formatDayLabel(day.date)}</h3>
        <p className="text-[11px] text-muted-foreground">
          you {formatDuration(s.handsOnMinutes)} · agents {formatDuration(s.agentMinutes)}
          {s.personHours >= 0.5 && ` · about ${formatHours(s.personHours)} person-hours`}
          {s.commits > 0 && ` · ${s.commits} ${s.commits === 1 ? 'commit' : 'commits'}`}
        </p>
      </header>

      <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-3 lg:grid-cols-2">
        {groups.map((g) => (
          <AgentGroup key={g.agentId ?? 'ri'} group={g} agent={agents.get(g.agentId)} onOpenChat={openExecution} />
        ))}
      </div>

      {(day.executionsFinished.length > 0 || day.tasksDone.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {day.executionsFinished.map((x) => (
            <span key={x.id} className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Archive size={11} />
              Finished {x.label}
            </span>
          ))}
          {day.tasksDone.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => openTask(t.id)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <CheckSquare size={11} />
              {t.title}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function AgentGroup({
  group,
  agent,
  onOpenChat,
}: {
  group: AgentDay;
  agent: WorkAgent | undefined;
  onOpenChat: (sessionId: string) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? group.commits : group.commits.slice(0, COMMITS_SHOWN);
  const colors = agentStyle(agent?.color ?? -1);
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-full" style={colors.dot} aria-hidden />
        <span className="truncate text-xs font-medium">{agent?.name ?? 'Ri'}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {formatDuration(group.agentMinutes)}
          {group.commits.length > 0 && ` · ${group.commits.length} ${group.commits.length === 1 ? 'commit' : 'commits'}`}
        </span>
      </div>
      <ul className="mt-1 space-y-0.5 pl-3.5">
        {shown.map((c) => (
          <li key={c.hash} className="flex items-start gap-1.5 text-[11.5px] leading-snug" title={`${c.lines} lines that count · about ${formatHours(c.effortHours)}h of work`}>
            <GitCommitHorizontal size={11} className="mt-[3px] shrink-0 text-muted-foreground" />
            <span className="min-w-0">{c.subject}</span>
          </li>
        ))}
        {group.commits.length > COMMITS_SHOWN && (
          <li>
            <button type="button" onClick={() => setAll(!all)} className="text-[11px] text-muted-foreground hover:text-foreground">
              {all ? 'Show fewer' : `Show all ${group.commits.length}`}
            </button>
          </li>
        )}
        {group.quietChats.map((chat) => (
          <li key={chat.sessionId}>
            <button
              type="button"
              onClick={() => chat.executionId && onOpenChat(chat.sessionId)}
              className="flex items-start gap-1.5 text-left text-[11.5px] leading-snug text-muted-foreground hover:text-foreground"
            >
              <MessageSquare size={11} className="mt-[3px] shrink-0" />
              <span className="min-w-0">
                {chat.label} <span className="text-[10px]">· {formatDuration(chat.agentMinutes)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
