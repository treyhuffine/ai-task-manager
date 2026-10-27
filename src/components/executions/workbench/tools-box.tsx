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
import { Tip } from '@/components/ui/tip';
import { Kbd } from '@/components/ui/kbd';

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
  const go = <RowChevron />;
  const status = c.runStatus;
  const port = c.state?.port ?? null;

  const row = (view: PanelView, icon: React.ReactNode, label: string, right: React.ReactNode, title?: string) => (
    <ToolsRow icon={icon} label={label} right={right} title={title} touch={touch} onClick={() => onShow(view)} />
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
      ? `on ${c.elsewhere?.deviceName ?? 'another device'}`
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
      <span className="truncate">{c.url ? hostOf(c.url) : `On ${c.elsewhere?.deviceName ?? 'another device'}`}</span>
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
        <Tip label="This worktree's branch">
          <div className="flex cursor-default items-center gap-1.5 px-2.5 pb-2 pt-1 text-[11.5px] text-muted-foreground/70">
            <GitBranch size={12} className="flex-shrink-0" />
            <span className="truncate font-mono text-[11px]">{branchName}</span>
          </div>
        </Tip>
      )}

      <Tip label="Open Run: status, controls and output">
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
      </Tip>

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

      <ToolsDivider />
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
      {row('files', <FileText size={15} />, 'Files', touch ? null : <Kbd aria-hidden>{HOTKEYS.goToFile.label}</Kbd>)}
      {terminal && (
        <Tip label={terminal.open ? 'Hide the terminal. Shells keep running.' : undefined}>
          <button
            type="button"
            onClick={terminal.onToggle}
            className={cn(
              'group flex w-full items-center gap-2.5 rounded-lg px-2.5 text-left font-medium text-foreground/85 transition-colors hover:bg-muted/60 hover:text-foreground',
              rowH,
              terminal.open && 'bg-muted/50 text-foreground',
            )}
          >
            <SquareTerminal size={15} className="flex-shrink-0 text-muted-foreground group-hover:text-foreground" />
            Terminal
            <span className="ml-auto text-[11.5px] font-normal text-muted-foreground/80">
              {terminal.open ? 'Open below' : <Kbd aria-hidden>{HOTKEYS.toggleTerminal.label}</Kbd>}
            </span>
            {terminal.open ? <ChevronDown size={13} className="flex-shrink-0 text-muted-foreground/60" /> : go}
          </button>
        </Tip>
      )}

      <ToolsDivider />
      {row('notes', <ListTodo size={15} />, 'Notes & tasks', linkedCount > 0 ? <span>{linkedCount} linked</span> : null)}
      {row(
        'scratch',
        <NotebookPen size={15} />,
        'Scratchpad',
        scratchHasContent ? (
          <Tip label="Has notes">
            <span aria-label="Has notes" className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70" />
          </Tip>
        ) : null,
      )}
    </div>
  );
}

/**
 * Pads a chat column's parts clear of a `FloatingToolsBox` floating over
 * it: below ~1390px of `@container/chat` width the box would cover text,
 * and below ~1060px it folds into an icon strip. Put it on the scrolling
 * element rather than its frame, so the scrollbar stays at the far right.
 */
export const TOOLS_BOX_CLEARANCE = '@max-[1390px]/chat:pr-[308px] @max-[1060px]/chat:pr-[60px]';

/**
 * The floating box shown while a tools panel is closed: the execution
 * view's (`ToolsBox`) and the agent view's. It floats over the chat
 * column's right side (the chat pads for it with `TOOLS_BOX_CLEARANCE`, so
 * it never covers text) and folds into an icon strip, `strip`, when the
 * column is tight. Needs a `@container/chat` ancestor. Borderless on
 * purpose: the surface and shadow separate it.
 */
export function FloatingToolsBox({ list, strip, label = 'Tools' }: { list: React.ReactNode; strip: React.ReactNode; label?: string }) {
  return (
    <>
      <div role="group" aria-label={label} className="absolute right-4 top-3 z-20 w-[288px] rounded-2xl bg-card p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.28)] @max-[1060px]/chat:hidden dark:shadow-[0_12px_32px_rgba(0,0,0,0.5)]">
        {list}
      </div>
      <div role="group" aria-label={label} className="absolute right-3 top-3 z-20 hidden flex-col gap-0.5 rounded-xl bg-card p-1 shadow-[0_12px_32px_rgba(0,0,0,0.28)] @max-[1060px]/chat:flex dark:shadow-[0_12px_32px_rgba(0,0,0,0.5)]">
        {strip}
      </div>
    </>
  );
}

/** A row in a tools list: it opens that tool, and carries a chevron. Status goes on its right, as text. */
export function ToolsRow({
  icon,
  label,
  right,
  title,
  touch = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  right?: React.ReactNode;
  title?: string;
  /** Larger touch targets for a phone sheet. */
  touch?: boolean;
  onClick: () => void;
}) {
  return (
    <Tip label={title}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'group flex w-full items-center gap-2.5 rounded-lg px-2.5 text-left font-medium text-foreground/85 transition-colors hover:bg-muted/60 hover:text-foreground',
          touch ? 'h-11 text-[14.5px]' : 'h-9 text-[13px]',
        )}
      >
        <span className="flex-shrink-0 text-muted-foreground group-hover:text-foreground">{icon}</span>
        <span className="min-w-0 truncate">{label}</span>
        <span className="ml-auto flex min-w-0 flex-shrink-0 items-center gap-2 text-[11.5px] font-normal text-muted-foreground/80">{right}</span>
        <RowChevron />
      </button>
    </Tip>
  );
}

/** A divider between groups of rows. */
export function ToolsDivider() {
  return <div className="my-1.5 h-px bg-border" />;
}

/** One tool in the folded icon strip, with an optional status dot. */
export function ToolsMini({
  icon,
  label,
  badge,
  active = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  /** The dot's color classes, when there's something to see. */
  badge?: string;
  /** Shown as on, like the terminal while its drawer is open. */
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <Tip label={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={cn(
          'relative inline-flex size-9 items-center justify-center rounded-lg text-foreground/80 transition-colors hover:bg-muted/70 hover:text-foreground',
          active && 'bg-muted/70 text-foreground',
        )}
      >
        {icon}
        {badge && <span aria-hidden className={cn('absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full', badge)} />}
      </button>
    </Tip>
  );
}

/** A divider in the icon strip. */
export function ToolsStripDivider() {
  return <span className="mx-1.5 my-0.5 h-px bg-border" />;
}

function RowChevron() {
  return <ChevronRight size={13} className="flex-shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground" />;
}

/** The execution view's box: its tools, while the panel is closed. */
export function ToolsBox(props: ToolsListProps) {
  const { controller: c, diffStats, onShow, terminal } = props;
  const status = c.runStatus;
  return (
    <FloatingToolsBox
      list={<ToolsList {...props} />}
      strip={
        <>
          <ToolsMini onClick={() => onShow('run')} icon={<Play size={15} />} label={`Run · ${RUN_STATUS_LABEL[status]}`} badge={status === 'not-configured' || status === 'stopped' || status === 'elsewhere' ? undefined : runDotClass(status)} />
          <ToolsMini onClick={() => onShow('preview')} icon={<AppWindow size={16} />} label="Preview" />
          <ToolsMini onClick={() => onShow('changes')} icon={<GitCompareArrows size={16} />} label={diffStats?.files ? `Changes · ${filesLabel(diffStats.files)}` : 'Changes'} badge={diffStats?.files ? 'bg-amber-500' : undefined} />
          <ToolsMini onClick={() => onShow('files')} icon={<FileText size={16} />} label="Files" />
          {terminal && (
            <ToolsMini onClick={terminal.onToggle} icon={<SquareTerminal size={16} />} label={terminal.open ? 'Hide the terminal' : 'Terminal'} active={terminal.open} />
          )}
          <ToolsStripDivider />
          <ToolsMini onClick={() => onShow('notes')} icon={<ListTodo size={16} />} label="Notes & tasks" />
          <ToolsMini onClick={() => onShow('scratch')} icon={<NotebookPen size={16} />} label="Scratchpad" badge={props.scratchHasContent ? 'bg-muted-foreground/70' : undefined} />
        </>
      }
    />
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
    <Tip label={title}>
      <button
        type="button"
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
    </Tip>
  );
}

function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return url;
  }
}
