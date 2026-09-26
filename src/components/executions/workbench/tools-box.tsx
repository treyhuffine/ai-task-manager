'use client';

import {
  AppWindow,
  ChevronDown,
  ChevronRight,
  FileText,
  GitBranch,
  GitCompareArrows,
  ListTodo,
  Loader2,
  NotebookPen,
  Play,
  Square,
  SquareTerminal,
} from 'lucide-react';
import { HOTKEYS } from '@/constants/commands';
import type { DiffStats } from '@/lib/api/sessions';
import { cn } from '@/lib/utils';
import { RUN_STATUS_LABEL, runDotClass, runIsActive } from '../preview/run-status';
import type { PreviewController } from '../preview/use-preview-controller';
import { filesLabel } from './changes-summary';
import type { PanelView } from './workbench-state';

export interface ToolsListProps {
  controller: PreviewController;
  branchName: string | null;
  /** Worktree diff totals (the same numbers the rail shows). */
  diffStats: DiffStats | null | undefined;
  /** Tasks and notes linked to this chat. */
  linkedCount: number;
  scratchHasContent: boolean;
  onShow: (view: PanelView) => void;
  /** Start the app and open Preview, on purpose. */
  onStartAndPreview: () => void;
  /** Desktop only. The phone has no terminal: it's a thin client. */
  terminal?: { open: boolean; onToggle: () => void };
  /** Larger touch targets for the phone's Tools sheet. */
  touch?: boolean;
}

/**
 * The tools, as one list: the desktop's floating box and the phone's Tools
 * sheet render the same rows in the same order as the panel's tabs.
 *
 * Three kinds of thing, kept visibly distinct:
 *   - status is text (the branch, "Running", "8 files"),
 *   - a row is navigation (it opens that view, and carries a chevron),
 *   - a labeled button runs something (Start, Stop, Start & preview).
 */
export function ToolsList({
  controller: c,
  branchName,
  diffStats,
  linkedCount,
  scratchHasContent,
  onShow,
  onStartAndPreview,
  terminal,
  touch = false,
}: ToolsListProps) {
  const rowH = touch ? 'h-11 text-[14.5px]' : 'h-9 text-[13px]';
  const go = <ChevronRight size={13} className="flex-shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground" />;
  const status = c.runStatus;
  const port = c.state?.port ?? null;

  const row = (view: PanelView, icon: React.ReactNode, label: string, right: React.ReactNode, title?: string) => (
    <button
      type="button"
      onClick={() => onShow(view)}
      title={title}
      className={cn('group flex w-full items-center gap-2.5 rounded-lg px-2.5 text-left font-medium text-foreground/85 transition-colors hover:bg-muted/60 hover:text-foreground', rowH)}
    >
      <span className="flex-shrink-0 text-muted-foreground group-hover:text-foreground">{icon}</span>
      {label}
      <span className="ml-auto flex min-w-0 items-center gap-2 text-[11.5px] font-normal text-muted-foreground/80">{right}</span>
      {go}
    </button>
  );

  // The process row: status in words, one labeled action, and it opens Run.
  const runAction =
    status === 'elsewhere' ? null : status === 'not-configured' ? (
      <ActionButton onClick={() => onShow('run')} title="Set the command that starts this app">Set up</ActionButton>
    ) : status === 'installing' ? (
      <Loader2 size={13} className="animate-spin text-muted-foreground" />
    ) : runIsActive(status) ? (
      <ActionButton onClick={c.stop} disabled={c.isStopping} title={`Stop ${c.command}. Preview can stay open.`}>
        <Square size={10} className="fill-current" />
        Stop
      </ActionButton>
    ) : (
      <ActionButton onClick={c.start} disabled={c.isStarting} title={`Run ${c.command} in this worktree without opening Preview`}>
        <Play size={10} className="fill-current" />
        {status === 'crashed' ? 'Restart' : 'Start'}
      </ActionButton>
    );
  const runDetail =
    status === 'elsewhere'
      ? `on ${c.elsewhere?.computerName ?? 'another computer'}`
      : status === 'not-configured'
      ? 'No start command yet'
      : status === 'running' && port
        ? `localhost:${port}`
        : status === 'crashed'
          ? 'exited, see output'
          : status === 'starting'
            ? 'waiting for its port'
            : status === 'installing'
              ? 'setup script running'
              : 'not running';

  // The interface row: opens Preview, and only starts anything when it says so.
  const previewRight =
    status === 'elsewhere' ? (
      <span className="truncate">{c.url ? hostOf(c.url) : `On ${c.elsewhere?.computerName ?? 'another computer'}`}</span>
    ) : status === 'not-configured' ? (
      <span>Needs a start command</span>
    ) : status === 'running' || c.url ? (
      <span className="truncate">{c.url ? hostOf(c.url) : `localhost:${port}`}</span>
    ) : status === 'starting' ? (
      <span>Starting</span>
    ) : status === 'installing' ? (
      <span>Waiting on setup</span>
    ) : status === 'crashed' ? (
      <span>App failed</span>
    ) : (
      <ActionButton onClick={onStartAndPreview} disabled={c.isStarting} title={`Run ${c.command} and open Preview`}>
        <Play size={10} className="fill-current" />
        Start &amp; preview
      </ActionButton>
    );

  return (
    <div className="flex flex-col">
      {branchName && (
        <div className="flex cursor-default items-center gap-1.5 px-2.5 pb-2 pt-1 text-[11.5px] text-muted-foreground/70" title="This worktree's branch">
          <GitBranch size={12} className="flex-shrink-0" />
          <span className="truncate font-mono text-[11px]">{branchName}</span>
        </div>
      )}

      <div
        role="button"
        tabIndex={0}
        onClick={() => onShow('run')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onShow('run');
          }
        }}
        title="Open Run: status, controls and output"
        className={cn(
          'group mb-0.5 flex w-full cursor-pointer items-center gap-2.5 rounded-lg bg-muted/35 px-2.5 text-left transition-colors hover:bg-muted/60',
          touch ? 'py-2.5' : 'py-1.5',
        )}
      >
        <span aria-hidden className={cn('h-2 w-2 flex-shrink-0 rounded-full', runDotClass(status))} />
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate font-medium text-foreground/90', touch ? 'text-[14.5px]' : 'text-[13px]')}>
            Run <span className="font-normal text-muted-foreground">· {RUN_STATUS_LABEL[status]}</span>
          </span>
          <span className="block truncate text-[11px] text-muted-foreground/70">
            {c.command && status !== 'not-configured' && <code className="font-mono">{c.command}</code>}
            {c.command && status !== 'not-configured' ? ' · ' : ''}
            {runDetail}
          </span>
        </span>
        {runAction}
        {go}
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={() => onShow('preview')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onShow('preview');
          }
        }}
        className={cn(
          'group flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left font-medium text-foreground/85 transition-colors hover:bg-muted/60 hover:text-foreground',
          rowH,
        )}
      >
        <AppWindow size={15} className="flex-shrink-0 text-muted-foreground group-hover:text-foreground" />
        Preview
        <span className="ml-auto flex min-w-0 items-center gap-2 text-[11.5px] font-normal text-muted-foreground/80">{previewRight}</span>
        {go}
      </div>

      <div className="my-1.5 h-px bg-border" />
      {row(
        'changes',
        <GitCompareArrows size={15} />,
        'Changes',
        diffStats && diffStats.files > 0 ? (
          <>
            <span className="font-medium text-foreground/75">{filesLabel(diffStats.files)}</span>
            <span className="font-mono text-[11px] tabular-nums opacity-75">
              <span className="text-emerald-600 dark:text-emerald-400">+{diffStats.additions}</span>{' '}
              <span className="text-rose-600 dark:text-rose-400">−{diffStats.deletions}</span>
            </span>
          </>
        ) : (
          <span>{diffStats ? 'None yet' : ''}</span>
        ),
        'Every change in this worktree, from every chat, against the base branch',
      )}
      {row('files', <FileText size={15} />, 'Files', touch ? null : <Kbd>{HOTKEYS.goToFile.label}</Kbd>)}
      {terminal && (
        <button
          type="button"
          onClick={terminal.onToggle}
          title={terminal.open ? 'Hide the terminal. Shells keep running.' : 'Open the terminal below'}
          className={cn(
            'group flex w-full items-center gap-2.5 rounded-lg px-2.5 text-left font-medium text-foreground/85 transition-colors hover:bg-muted/60 hover:text-foreground',
            rowH,
            terminal.open && 'bg-muted/50 text-foreground',
          )}
        >
          <SquareTerminal size={15} className="flex-shrink-0 text-muted-foreground group-hover:text-foreground" />
          Terminal
          <span className="ml-auto text-[11.5px] font-normal text-muted-foreground/80">
            {terminal.open ? 'Open below' : <Kbd>{HOTKEYS.toggleTerminal.label}</Kbd>}
          </span>
          {terminal.open ? <ChevronDown size={13} className="flex-shrink-0 text-muted-foreground/60" /> : go}
        </button>
      )}

      <div className="my-1.5 h-px bg-border" />
      {row('notes', <ListTodo size={15} />, 'Notes & tasks', linkedCount > 0 ? <span>{linkedCount} linked</span> : null)}
      {row(
        'scratch',
        <NotebookPen size={15} />,
        'Scratchpad',
        scratchHasContent ? <span aria-label="Has notes" title="Has notes" className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70" /> : null,
      )}
    </div>
  );
}

/**
 * The floating box shown while the panel is closed. It floats over the
 * chat column's right side (the chat pads for it at narrower widths, so it
 * never covers text) and folds into an icon strip when the column is tight.
 * Borderless on purpose: the surface and shadow separate it.
 */
export function ToolsBox(props: ToolsListProps) {
  const { controller: c, diffStats, onShow, terminal } = props;
  const status = c.runStatus;
  const mini = (view: PanelView, icon: React.ReactNode, label: string, badge?: string) => (
    <button
      type="button"
      onClick={() => onShow(view)}
      title={label}
      aria-label={label}
      className="relative inline-flex size-9 items-center justify-center rounded-lg text-foreground/80 transition-colors hover:bg-muted/70 hover:text-foreground"
    >
      {icon}
      {badge && <span aria-hidden className={cn('absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full', badge)} />}
    </button>
  );
  return (
    <>
      <div className="absolute right-4 top-3 z-20 w-[288px] rounded-2xl bg-card p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.28)] @max-[1060px]/chat:hidden dark:shadow-[0_12px_32px_rgba(0,0,0,0.5)]">
        <ToolsList {...props} />
      </div>
      <div className="absolute right-3 top-3 z-20 hidden flex-col gap-0.5 rounded-xl bg-card p-1 shadow-[0_12px_32px_rgba(0,0,0,0.28)] @max-[1060px]/chat:flex dark:shadow-[0_12px_32px_rgba(0,0,0,0.5)]">
        {mini('run', <Play size={15} />, `Run · ${RUN_STATUS_LABEL[status]}`, status === 'not-configured' || status === 'stopped' || status === 'elsewhere' ? undefined : runDotClass(status))}
        {mini('preview', <AppWindow size={16} />, 'Preview')}
        {mini('changes', <GitCompareArrows size={16} />, diffStats?.files ? `Changes · ${filesLabel(diffStats.files)}` : 'Changes', diffStats?.files ? 'bg-amber-500' : undefined)}
        {mini('files', <FileText size={16} />, 'Files')}
        {terminal && (
          <button
            type="button"
            onClick={terminal.onToggle}
            title={terminal.open ? 'Hide the terminal' : 'Terminal'}
            aria-label="Terminal"
            className={cn(
              'inline-flex size-9 items-center justify-center rounded-lg text-foreground/80 transition-colors hover:bg-muted/70 hover:text-foreground',
              terminal.open && 'bg-muted/70 text-foreground',
            )}
          >
            <SquareTerminal size={16} />
          </button>
        )}
        <span className="mx-1.5 my-0.5 h-px bg-border" />
        {mini('notes', <ListTodo size={16} />, 'Notes & tasks')}
        {mini('scratch', <NotebookPen size={16} />, 'Scratchpad', props.scratchHasContent ? 'bg-muted-foreground/70' : undefined)}
      </div>
    </>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={(e) => {
        // The row around it navigates. This runs something instead.
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className="inline-flex h-7 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-background px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[9.5px] leading-none text-muted-foreground">{children}</kbd>;
}

function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return url;
  }
}
