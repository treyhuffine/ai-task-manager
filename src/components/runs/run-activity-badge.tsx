'use client';

/**
 * Live activity badge for a run row. Renders the structured
 * observation as a small pill that says what the agent is actually
 * doing — "Working", "Bash in flight for 4 min", "Awaiting input",
 * "Quiet for 12 min" — instead of the wall-clock-timer pattern.
 *
 * No automatic action: this is purely a status surface. Users (and
 * eventually the orchestrator) decide whether to intervene.
 */

import { AlertTriangle, Hourglass, MessageSquare, Skull, Wrench } from 'lucide-react';
import { useRunObservation } from '@/hooks/use-run-observation';
import { cn } from '@/lib/utils';

export function RunActivityBadge({
  runId,
  /** When the parent already knows the run is terminal, skip the
   *  polling network round-trip and render the terminal pill directly. */
  terminalStatus,
}: {
  runId: string;
  terminalStatus?: 'completed' | 'failed' | 'skipped' | 'cancelled';
}) {
  const { data } = useRunObservation(terminalStatus ? null : runId);

  if (terminalStatus) {
    return <TerminalBadge status={terminalStatus} />;
  }

  if (!data) return null;

  const a = data.activity;
  switch (a.kind) {
    case 'terminal':
      return <TerminalBadge status={a.status} />;
    case 'crashed':
      return (
        <Pill tone="destructive" icon={<Skull size={10} />}>
          Subprocess gone
        </Pill>
      );
    case 'awaiting_input':
      return (
        <Pill tone="warn" icon={<MessageSquare size={10} />}>
          Awaiting input{a.toolName ? ` · ${a.toolName}` : ''}
        </Pill>
      );
    case 'tool_in_flight':
      return (
        <Pill tone={data.stallWarning ? 'warn' : 'info'} icon={<Wrench size={10} />}>
          {a.tool} · {humanMs(a.inFlightForMs)}
        </Pill>
      );
    case 'working':
      return (
        <Pill tone="active" icon={<span className="size-1.5 rounded-full bg-current" />}>
          Working
        </Pill>
      );
    case 'stalled':
      return (
        <Pill
          tone={data.stallWarning ? 'warn' : 'mute'}
          icon={data.stallWarning ? <AlertTriangle size={10} /> : <Hourglass size={10} />}
        >
          Quiet · {humanMs(a.quietForMs)}
        </Pill>
      );
    case 'queued':
      return (
        <Pill tone="info" icon={<Hourglass size={10} />}>
          Queued
        </Pill>
      );
  }
}

function TerminalBadge({ status }: { status: 'completed' | 'failed' | 'skipped' | 'cancelled' }) {
  if (status === 'completed') {
    return <Pill tone="success">Completed</Pill>;
  }
  if (status === 'failed') {
    return <Pill tone="destructive">Failed</Pill>;
  }
  if (status === 'cancelled') {
    return <Pill tone="mute">Cancelled</Pill>;
  }
  return <Pill tone="mute">Skipped</Pill>;
}

type PillTone = 'active' | 'info' | 'warn' | 'destructive' | 'success' | 'mute';

function Pill({
  tone,
  icon,
  children,
}: {
  tone: PillTone;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const cls: Record<PillTone, string> = {
    active: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
    info: 'bg-muted text-muted-foreground border-border',
    warn: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
    destructive: 'bg-destructive/10 text-destructive border-destructive/30',
    success: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
    mute: 'bg-muted text-muted-foreground border-border',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium border',
        cls[tone],
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function humanMs(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)} min`;
  return `${Math.round(ms / (60 * 60_000))} hr`;
}
