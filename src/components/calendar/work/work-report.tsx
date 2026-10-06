"use client";

import { useState } from 'react';
import { Archive, Check, CheckSquare, Copy, FileText, GitCommitHorizontal, Loader2, MessageSquare } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useSaveWorkReport } from '@/hooks/use-work';
import { formatDayLabel } from '@/lib/calendar/dates';
import { formatDuration, formatHours, formatSpan, summaryLines } from '@/lib/work/equivalents';
import type { WorkAgent, WorkChat, WorkCommit, WorkDay, WorkRange } from '@/lib/work/types';
import { cn } from '@/lib/utils';
import { WorkWorth } from './work-worth';
import { agentStyle, seriesColor } from './work-style';
import { Tip } from '@/components/ui/tip';

/** Commits shown per agent per day before "Show all". */
const COMMITS_SHOWN = 6;

/**
 * The Report tab (docs/work-view.md, "Report"): the week or day in words,
 * each agent's time beside what a person would need for the same work, then
 * day by day what shipped, which chats ran without a commit, and finished
 * executions and tasks. The calendar's own days stay in Calendar and List.
 */
export function WorkReport({ range, today }: { range: WorkRange; today: string }) {
  const agents = new Map(range.agents.map((a) => [a.id, a] as const));
  const days = range.dayList.filter(
    (d) => d.spans.length || d.looseCommits.length || d.tasksDone.length || d.executionsFinished.length,
  );
  return (
    <div className="h-full overflow-y-auto pb-6 pr-1">
      <div className="grid gap-x-10 gap-y-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <ReportSummary range={range} />
        <AgentTable range={range} />
      </div>
      {days.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No agent work in this range yet.</p>
      ) : (
        <div className="mt-7 space-y-5">
          {days.map((day) => (
            <DaySection key={day.date} day={day} agents={agents} isToday={day.date === today} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The three-line report, to copy or keep as a note. */
function ReportSummary({ range }: { range: WorkRange }) {
  const save = useSaveWorkReport();
  const { openNote } = useDashboard();
  const [copied, setCopied] = useState(false);
  // Pasted somewhere, the summary has no tiles above it, so the numbers come along.
  const text = [...range.report, '', ...summaryLines(range.totals, range.days)].join('\n');

  return (
    <section aria-labelledby="work-report-summary">
      <div className="flex items-center gap-2">
        <h3 id="work-report-summary" className="text-xs font-medium text-muted-foreground">
          Summary
        </h3>
        <div className="flex-1" />
        <Tip label="Copy the summary and the numbers as text">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </Tip>
        <Tip label="Save the report as a note, with every commit by agent">
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate({ start: range.start, days: range.days }, { onSuccess: (note) => openNote(note.id) })}
            className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {save.isPending ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
            Save as note
          </button>
        </Tip>
      </div>
      <div className="mt-2 space-y-2">
        {range.report.map((line) => (
          <p key={line} className="text-sm leading-relaxed text-foreground">
            {line}
          </p>
        ))}
      </div>
    </section>
  );
}

/**
 * Each agent's time beside what a person would need for the same work, on one
 * scale, largest first. Every agent by name, so "Other" splits back out here.
 */
function AgentTable({ range }: { range: WorkRange }) {
  const rows = range.agents
    .filter((a) => a.agentMinutes >= 1 || a.personHours >= 0.5)
    .sort((a, b) => b.personHours - a.personHours || b.agentMinutes - a.agentMinutes);
  if (rows.length === 0) return null;
  const max = Math.max(1, ...rows.map((a) => a.personHours));
  return (
    <section aria-labelledby="work-report-agents">
      <h3 id="work-report-agents" className="text-xs font-medium text-muted-foreground">
        By agent
      </h3>
      <table className="mt-2 w-full border-separate border-spacing-0 text-[11.5px]">
        <thead>
          <tr className="whitespace-nowrap text-left text-[10px] text-muted-foreground">
            <th scope="col" className="pb-1 pr-3 font-normal">Agent</th>
            <th scope="col" className="pb-1 pr-3 text-right font-normal">Agents ran</th>
            <th scope="col" className="pb-1 pr-3 font-normal">A person would need</th>
            <th scope="col" className="pb-1 text-right font-normal">Commits</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <Tip key={a.id ?? 'ri'} label={`${a.name}: ran ${formatDuration(a.agentMinutes)}, a person would need about ${formatHours(a.personHours)} hours${a.commits ? `, ${a.commits} ${a.commits === 1 ? 'commit' : 'commits'}` : ''}`}>
              <tr
                className="hover:bg-muted/40"
              >
                <td className="max-w-48 py-[3px] pr-3">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="size-2 shrink-0 rounded-[2px]" style={agentStyle(a.color).dot} aria-hidden />
                    <span className="truncate text-foreground">{a.name}</span>
                  </span>
                </td>
                <td className="whitespace-nowrap py-[3px] pr-3 text-right tabular-nums text-muted-foreground">
                  {a.agentMinutes >= 1 ? formatSpan(a.agentMinutes) : ''}
                </td>
                <td className="w-full py-[3px] pr-3">
                  <span className="flex items-center gap-2">
                    <span className="block h-2 min-w-[2px] rounded-r-[4px]" style={{ width: `${(a.personHours / max) * 82}%`, backgroundColor: seriesColor(a.color) }} />
                    <span className="shrink-0 tabular-nums text-foreground">{formatHours(a.personHours)}h</span>
                  </span>
                </td>
                <td className="py-[3px] text-right tabular-nums text-muted-foreground">{a.commits || ''}</td>
              </tr>
            </Tip>
          ))}
        </tbody>
      </table>
    </section>
  );
}

interface AgentDay {
  agentId: string | null;
  agentMinutes: number;
  personHours: number;
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
      e = { agentId: id, agentMinutes: 0, personHours: 0, commits: [], quietChats: [] };
      byAgent.set(id, e);
    }
    return e;
  };
  for (const span of day.spans) {
    const e = entry(span.agentId);
    e.agentMinutes += span.agentMinutes;
    e.personHours += span.personHours;
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
  for (const c of day.looseCommits) {
    const e = entry(c.agentId);
    e.commits.push(c);
    e.personHours += c.effortHours;
  }
  const groups = [...byAgent.values()].sort((a, b) => b.personHours - a.personHours || b.agentMinutes - a.agentMinutes);

  return (
    <section>
      <header className="sticky top-0 z-10 flex flex-wrap items-baseline gap-x-2 border-b border-border/60 bg-background pb-1.5">
        <h3 className={cn('text-sm font-medium', isToday && 'text-primary')}>{formatDayLabel(day.date)}</h3>
        <p className="text-[11px] text-muted-foreground">
          {s.handsOnMinutes >= 1 && <>you {formatSpan(s.handsOnMinutes)} · </>}
          <WorkWorth stats={s} />
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
  const colors = agentStyle(agent?.color ?? 0);
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-[2px]" style={colors.dot} aria-hidden />
        <span className="truncate text-xs font-medium">{agent?.name ?? 'Ri'}</span>
        <Tip label={`Ran ${formatDuration(group.agentMinutes)}. A person would need about ${formatHours(group.personHours)} hours.`}>
          <span
            className="shrink-0 text-[10px] text-muted-foreground"
          >
            {formatSpan(group.agentMinutes)}
            {group.personHours >= 0.5 && ` → ${formatHours(group.personHours)}h`}
            {group.commits.length > 0 && ` · ${group.commits.length} ${group.commits.length === 1 ? 'commit' : 'commits'}`}
          </span>
        </Tip>
      </div>
      <ul className="mt-1 space-y-0.5 pl-3.5">
        {shown.map((c) => (
          <Tip key={c.hash} label={`${c.lines} lines that count · about ${formatHours(c.effortHours)}h of work`}>
            <li className="flex items-start gap-1.5 text-[11.5px] leading-snug">
              <GitCommitHorizontal size={11} className="mt-[3px] shrink-0 text-muted-foreground" />
              <span className="min-w-0">{c.subject}</span>
            </li>
          </Tip>
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
