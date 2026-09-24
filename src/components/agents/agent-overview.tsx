'use client';

import type { ReactNode } from 'react';
import { AppWindow, ExternalLink, ListTodo, Loader2, Pin, Plus } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useAgentExecutions, useAgentPreviews, useAgentTasks } from '@/hooks/use-agent';
import { useDiffStats } from '@/hooks/use-workspaces';
import { openLauncher } from '@/components/workspaces/launcher/launcher-store';
import { DiffStatsPair } from '@/components/workspaces/diff-stats';
import { SessionRowMenu } from '@/components/workspaces/session-row-menu';
import { harnessDefinition } from '@/lib/harness/registry';
import { formatCompactRelative } from '@/lib/utils/relative-time';
import type { RailSession } from '@/lib/api/sessions';
import type { AgentPreview } from '@/lib/api/agents';
import type { WorkspaceRecord } from '@/db/types';
import type { AgentTab } from '@/types/dashboard';
import { cn } from '@/lib/utils';

type RowState = 'approve' | 'unread' | 'working' | 'idle';

/**
 * The agent's work at a glance (docs/agents-view-spec.md Phase 7): its
 * executions grouped the way the rail groups them, its pinned ones, the
 * tasks they are working, and its previews.
 */
export function AgentOverview({
  workspace,
  onSelectTab,
}: {
  workspace: WorkspaceRecord;
  onSelectTab: (tab: AgentTab) => void;
}) {
  const { needsYou, working, recent, pinned, all, isLoading } = useAgentExecutions(workspace.id);
  const archived = workspace.status === 'archived';

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={14} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (all.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-center px-8">
        <div>
          <p className="text-[13px] font-semibold text-foreground">No work yet</p>
          <p className="text-[11px] text-muted-foreground/80 mt-1 max-w-xs">
            {archived
              ? 'This agent is archived.'
              : `Start an execution in ${workspace.name}, or ask its main chat to start one for you.`}
          </p>
          {!archived && (
            <button
              onClick={() => openLauncher(workspace.id)}
              className="mt-3 inline-flex items-center gap-1.5 h-7 px-3 rounded-lg bg-primary text-primary-foreground text-[11px] font-semibold hover:opacity-90"
            >
              <Plus size={12} strokeWidth={2.5} />
              New execution
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-5">
      {pinned.length > 0 && (
        <Section title="Pinned" icon={<Pin size={10} className="-rotate-45" />} count={pinned.length}>
          {pinned.map((s) => (
            <ExecutionRow key={s.id} session={s} state={stateOf(s, needsYou, working)} />
          ))}
        </Section>
      )}
      <Section title="Needs you" count={needsYou.length} tone="attention" empty="Nothing waiting on you.">
        {needsYou.map(({ session, bucket }) => (
          <ExecutionRow key={session.id} session={session} state={bucket === 'needsApproval' ? 'approve' : 'unread'} />
        ))}
      </Section>
      <Section title="Working" count={working.length} tone="working" empty="Nothing running right now.">
        {working.map((s) => (
          <ExecutionRow key={s.id} session={s} state="working" />
        ))}
      </Section>
      {recent.length > 0 && (
        <Section title="Recent" count={recent.length}>
          {recent.map((s) => (
            <ExecutionRow key={s.id} session={s} state="idle" />
          ))}
        </Section>
      )}
      <AgentTasksSection workspaceId={workspace.id} />
      <AgentPreviewsSection workspaceId={workspace.id} onOpenPreviewTab={() => onSelectTab('preview')} />
    </div>
  );
}

function stateOf(
  session: RailSession,
  needsYou: Array<{ session: RailSession; bucket: string }>,
  working: RailSession[],
): RowState {
  const waiting = needsYou.find((n) => n.session.id === session.id);
  if (waiting) return waiting.bucket === 'needsApproval' ? 'approve' : 'unread';
  if (working.some((w) => w.id === session.id)) return 'working';
  return 'idle';
}

function Section({
  title,
  icon,
  count,
  tone,
  empty,
  children,
}: {
  title: string;
  icon?: ReactNode;
  count: number;
  tone?: 'attention' | 'working';
  /** Shown when the section has nothing. Sections without it hide instead. */
  empty?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="flex items-center gap-1.5 px-1 mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {icon}
        {title}
        {count > 0 && (
          <span
            className={cn(
              'rounded-full px-1.5 text-[9.5px] font-semibold normal-case tracking-normal',
              tone === 'attention'
                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                : tone === 'working'
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : 'bg-muted text-muted-foreground',
            )}
          >
            {count}
          </span>
        )}
      </h3>
      {count === 0 && empty ? (
        <p className="px-1 text-[11px] text-muted-foreground/60">{empty}</p>
      ) : (
        <div className="space-y-px">{children}</div>
      )}
    </section>
  );
}

/** One execution: label, diff, harness and last activity. Opens the execution view. */
function ExecutionRow({ session, state }: { session: RailSession; state: RowState }) {
  const { openExecution, activeSessionId } = useDashboard();
  const { data: diffStats } = useDiffStats(session.id, session.executionId ?? null);
  const label = session.execution?.label ?? session.label ?? 'Untitled';
  const untitled = !(session.execution?.label ?? session.label);
  const timestamp = session.lastActivityAt ?? session.lastOutcomeEventAt ?? session.startedAt;
  const isPinned = !!session.execution?.pinnedAt;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openExecution(session.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openExecution(session.id);
        }
      }}
      className={cn(
        'group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors',
        activeSessionId === session.id ? 'bg-secondary' : 'hover:bg-muted/50',
      )}
    >
      <StateDot state={state} />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'truncate text-[12px]',
            untitled ? 'italic text-muted-foreground/70' : 'text-foreground/90',
            state === 'unread' && !untitled ? 'font-semibold' : 'font-medium',
          )}
        >
          {label}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
          <span>{harnessDefinition(session.harness).name}</span>
          <DiffStatsPair stats={diffStats} className="text-[9.5px]" />
        </div>
      </div>
      <div className="relative flex items-center flex-shrink-0 text-[10px] min-h-5">
        <span className="transition-opacity group-hover:opacity-0 group-has-data-[state=open]:opacity-0">
          {state === 'approve' ? (
            <span className="font-medium text-amber-500/90">approve</span>
          ) : state === 'working' ? (
            <span className="text-emerald-600/80 dark:text-emerald-400/80">working</span>
          ) : (
            <span className="text-muted-foreground/70">{formatCompactRelative(timestamp)}</span>
          )}
        </span>
        <SessionRowMenu
          sessionId={session.id}
          workspaceId={session.workspaceId ?? null}
          isUnread={state === 'unread'}
          isPinned={isPinned}
          label={label}
          className="absolute right-0 top-1/2 -translate-y-1/2"
        />
      </div>
    </div>
  );
}

function StateDot({ state }: { state: RowState }) {
  return (
    <span
      aria-hidden
      className={cn(
        'w-1.5 h-1.5 rounded-full flex-shrink-0',
        state === 'approve' && 'bg-amber-500',
        state === 'unread' && 'bg-amber-500',
        state === 'working' && 'bg-emerald-500 animate-pulse',
        state === 'idle' && 'bg-muted-foreground/25',
      )}
    />
  );
}

function AgentTasksSection({ workspaceId }: { workspaceId: string }) {
  const { openTask } = useDashboard();
  const { data } = useAgentTasks(workspaceId);
  const tasks = data?.tasks ?? [];
  if (tasks.length === 0) return null;
  return (
    <Section title="Tasks" icon={<ListTodo size={10} />} count={tasks.length}>
      <div className="flex flex-wrap gap-1.5 px-1 pt-0.5">
        {tasks.map((t) => (
          <button
            key={t.id}
            onClick={() => openTask(t.id)}
            title={`Open "${t.title}"`}
            className={cn(
              'inline-flex max-w-[16rem] items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] transition-colors',
              t.status === 'in_progress'
                ? 'border-violet-500/30 bg-violet-500/[0.06] text-foreground hover:border-violet-500/50'
                : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="truncate">{t.title || 'Untitled'}</span>
          </button>
        ))}
      </div>
    </Section>
  );
}

function AgentPreviewsSection({ workspaceId, onOpenPreviewTab }: { workspaceId: string; onOpenPreviewTab: () => void }) {
  const { data } = useAgentPreviews(workspaceId);
  const previews = data?.previews ?? [];
  if (previews.length === 0) return null;
  return (
    <Section title="Preview" icon={<AppWindow size={10} />} count={previews.length}>
      {previews.map((p) => (
        <PreviewRow key={`${p.executionId}:${p.service ?? ''}`} preview={p} onOpen={onOpenPreviewTab} />
      ))}
    </Section>
  );
}

function PreviewRow({ preview, onOpen }: { preview: AgentPreview; onOpen: () => void }) {
  const running = preview.serverStatus === 'running';
  const url = preview.remoteUrl ?? preview.localUrl;
  const statusLabel =
    preview.serverStatus === 'running'
      ? preview.port ? `running on port ${preview.port}` : 'running'
      : preview.serverStatus === 'starting'
        ? 'starting'
        : preview.serverStatus === 'crashed'
          ? 'crashed'
          : 'stopped';
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50">
      <span
        aria-hidden
        className={cn(
          'w-1.5 h-1.5 rounded-full flex-shrink-0',
          running ? 'bg-emerald-500' : preview.serverStatus === 'crashed' ? 'bg-rose-500' : 'bg-muted-foreground/30',
        )}
      />
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="truncate text-[12px] font-medium text-foreground/90">
          {preview.label ?? preview.previewName}
          {preview.service ? <span className="text-muted-foreground/70"> · {preview.service}</span> : null}
        </div>
        <div className="text-[10px] text-muted-foreground/70">{statusLabel}</div>
      </button>
      {running && url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-[10.5px] text-primary hover:underline flex-shrink-0"
        >
          Open
          <ExternalLink size={10} />
        </a>
      )}
    </div>
  );
}
