'use client';

import { useState } from 'react';
import {
  Terminal,
  Bot,
  Boxes,
  Loader2,
  CheckCircle2,
  XCircle,
  CircleSlash,
  ChevronRight,
  ChevronLeft,
  Square,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatSpanSeconds } from '@/lib/executions/duration';
import type { ChatEventRecord } from '@/db/types';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useSessionEvents, useStopBackgroundTask } from '@/hooks/use-execution';
import {
  useBackgroundTasks,
  deriveTaskDetail,
  type BackgroundTask,
  type BackgroundTaskStatus,
} from '@/hooks/use-background-tasks';

/**
 * Thin background-task strip above the composer. Renders only while something
 * is running (finished jobs already appear inline in the transcript as the
 * Bash/Task tool call that launched them). Click to open a sheet with the
 * running list, per-task detail (command/output/updates — all from existing
 * events, no file watcher), and a Stop button (agentex 0.0.22 `stopTask`).
 */
export function BackgroundTasksBar({ sessionId }: { sessionId: string }) {
  const { data: events } = useSessionEvents(sessionId);
  const tasks = useBackgroundTasks(events);
  const running = tasks.filter((t) => t.isActive);
  const [open, setOpen] = useState(false);

  if (running.length === 0) return null;

  const label =
    running.length === 1
      ? running[0].description ?? '1 background task'
      : `${running.length} background tasks`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 border-b border-border/60 px-5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground/80"
      >
        <span className="relative flex size-1.5 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-500 opacity-75" />
          <span className="relative inline-flex size-1.5 rounded-full bg-amber-500" />
        </span>
        <span className="truncate">{label}</span>
        <span className="ml-auto flex shrink-0 items-center gap-0.5 text-muted-foreground/50">
          running <ChevronRight className="size-3" />
        </span>
      </button>

      <BackgroundTasksSheet
        open={open}
        onOpenChange={setOpen}
        sessionId={sessionId}
        events={events ?? []}
        tasks={tasks}
      />
    </>
  );
}

function BackgroundTasksSheet({
  open,
  onOpenChange,
  sessionId,
  events,
  tasks,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  sessionId: string;
  events: ChatEventRecord[];
  tasks: BackgroundTask[];
}) {
  const running = tasks.filter((t) => t.isActive);
  const done = tasks.filter((t) => !t.isActive);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const selected = tasks.find((t) => t.taskId === selectedId) ?? null;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setSelectedId(null);
          setShowDone(false);
        }
        onOpenChange(o);
      }}
    >
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        {selected ? (
          <TaskDetail
            sessionId={sessionId}
            events={events}
            task={selected}
            onBack={() => setSelectedId(null)}
          />
        ) : (
          <>
            <SheetHeader className="border-b">
              <SheetTitle className="text-sm">Background tasks</SheetTitle>
            </SheetHeader>
            <ul className="flex-1 overflow-y-auto">
              {running.map((t) => (
                <TaskListRow
                  key={t.taskId}
                  sessionId={sessionId}
                  task={t}
                  onSelect={() => setSelectedId(t.taskId)}
                />
              ))}
              {showDone &&
                done.map((t) => (
                  <TaskListRow
                    key={t.taskId}
                    sessionId={sessionId}
                    task={t}
                    onSelect={() => setSelectedId(t.taskId)}
                    muted
                  />
                ))}
              {done.length > 0 && (
                <li>
                  <button
                    type="button"
                    onClick={() => setShowDone((v) => !v)}
                    className="flex w-full items-center justify-center gap-1 px-3 py-2 text-[10px] text-muted-foreground/70 transition-colors hover:bg-muted/40 hover:text-muted-foreground"
                  >
                    {showDone ? 'Hide finished' : `Show ${done.length} finished`}
                  </button>
                </li>
              )}
            </ul>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function TaskListRow({
  sessionId,
  task,
  onSelect,
  muted,
}: {
  sessionId: string;
  task: BackgroundTask;
  onSelect: () => void;
  muted?: boolean;
}) {
  const TypeIcon = typeIcon(task.taskType);
  return (
    <li className="border-b last:border-b-0">
      <div className={cn('flex items-center gap-2.5 pr-2 text-xs', muted && 'opacity-70')}>
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-3 text-left transition-colors hover:bg-muted/60"
        >
          <TypeIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[11px] text-foreground/90">
              {task.description ?? task.taskId}
            </div>
            <div className="truncate text-[10px] text-muted-foreground/70">{metaLine(task)}</div>
          </div>
          <StatusBadge status={task.status} active={task.isActive} />
        </button>
        {task.isActive && <StopButton sessionId={sessionId} taskId={task.taskId} />}
        <ChevronRight className="size-3 shrink-0 text-muted-foreground/40" />
      </div>
    </li>
  );
}

function TaskDetail({
  sessionId,
  events,
  task,
  onBack,
}: {
  sessionId: string;
  events: ChatEventRecord[];
  task: BackgroundTask;
  onBack: () => void;
}) {
  const detail = deriveTaskDetail(events, task);
  const TypeIcon = typeIcon(task.taskType);

  return (
    <>
      <SheetHeader className="gap-2 border-b">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 self-start text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" /> All tasks
        </button>
        <SheetTitle className="flex items-center gap-2 text-sm">
          <TypeIcon className="size-4 text-muted-foreground" />
          <span className="truncate">{task.description ?? task.taskId}</span>
        </SheetTitle>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">{metaLine(task)}</span>
          <div className="flex items-center gap-2">
            <StatusBadge status={task.status} active={task.isActive} />
            {task.isActive && <StopButton sessionId={sessionId} taskId={task.taskId} />}
          </div>
        </div>
      </SheetHeader>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {detail.command && (
          <Section label="Command">
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[11px] text-foreground/90">
              {detail.command}
            </pre>
          </Section>
        )}

        <Section label="Output">
          {detail.output ? (
            <pre
              className={cn(
                'max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[11px]',
                detail.outputIsError ? 'text-red-600 dark:text-red-500' : 'text-foreground/90',
              )}
            >
              {detail.output}
            </pre>
          ) : task.isActive ? (
            <p className="text-[11px] italic text-muted-foreground/70">
              Still running. Captured output appears when it finishes; live stdout isn’t streamed
              here yet.
            </p>
          ) : (
            <p className="text-[11px] italic text-muted-foreground/70">No output captured.</p>
          )}
        </Section>

        <Section label="Updates">
          <ol className="space-y-1.5">
            {detail.updates.map((u, i) => (
              <li key={i} className="flex items-start gap-2 text-[11px]">
                <span className="shrink-0 font-mono text-muted-foreground/60">{clock(u.at)}</span>
                <span className="text-foreground/80">
                  {u.phase}
                  {u.status ? ` · ${u.status}` : ''}
                  {u.description && u.phase !== 'started' ? ` · ${u.description}` : ''}
                </span>
              </li>
            ))}
          </ol>
        </Section>
      </div>
    </>
  );
}

function StopButton({ sessionId, taskId }: { sessionId: string; taskId: string }) {
  const stop = useStopBackgroundTask(sessionId);
  const couldntStop = !stop.isPending && stop.data?.stopped === false;
  return (
    <button
      type="button"
      title={couldntStop ? 'Could not stop (already ended or unsupported)' : 'Stop this task'}
      disabled={stop.isPending}
      onClick={(e) => {
        e.stopPropagation();
        stop.mutate(taskId);
      }}
      className={cn(
        'flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] transition-colors',
        couldntStop
          ? 'border-border text-muted-foreground/60'
          : 'border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-500',
      )}
    >
      {stop.isPending ? (
        <Loader2 className="size-2.5 animate-spin" />
      ) : (
        <Square className="size-2.5 fill-current" />
      )}
      {couldntStop ? 'ended' : 'Stop'}
    </button>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
        {label}
      </div>
      {children}
    </div>
  );
}

function StatusBadge({ status, active }: { status: BackgroundTaskStatus; active: boolean }) {
  if (active) {
    return (
      <span className="flex shrink-0 items-center gap-1 text-[10px] text-amber-600 dark:text-amber-500">
        <Loader2 className="size-3 animate-spin" />
        {status === 'pending' ? 'queued' : status === 'paused' ? 'paused' : 'running'}
      </span>
    );
  }
  const map = {
    completed: { Icon: CheckCircle2, cls: 'text-emerald-600 dark:text-emerald-500', label: 'done' },
    failed: { Icon: XCircle, cls: 'text-red-600 dark:text-red-500', label: 'failed' },
    killed: { Icon: CircleSlash, cls: 'text-muted-foreground', label: 'killed' },
    stopped: { Icon: CircleSlash, cls: 'text-muted-foreground', label: 'stopped' },
  } as const;
  const e = map[status as keyof typeof map] ?? map.completed;
  return (
    <span className={cn('flex shrink-0 items-center gap-1 text-[10px]', e.cls)}>
      <e.Icon className="size-3" />
      {e.label}
    </span>
  );
}

function typeIcon(taskType?: string) {
  if (taskType === 'local_bash') return Terminal;
  if (taskType === 'local_agent' || taskType === 'remote_agent') return Bot;
  return Boxes;
}

function metaLine(t: BackgroundTask): string {
  const parts: string[] = [];
  if (t.taskType === 'local_bash') parts.push('shell');
  else if (t.taskType) parts.push(t.taskType.replace(/_/g, ' '));
  if (typeof t.totalTokens === 'number') parts.push(`${formatTokens(t.totalTokens)} tok`);
  if (typeof t.durationMs === 'number') parts.push(formatDuration(t.durationMs));
  return parts.join(' · ');
}

function clock(iso: string): string {
  const t = iso.split('T')[1] ?? '';
  return t.slice(0, 8) || iso;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(ms: number): string {
  return formatSpanSeconds(ms / 1000) ?? '0s';
}
