'use client';

import { useState } from 'react';
import {
  AppWindow,
  ChevronDown,
  ChevronLeft,
  File,
  FileText,
  GitCompareArrows,
  ListTodo,
  MoreHorizontal,
  NotebookPen,
  Play,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { runDotClass } from '../preview/run-status';
import type { Workbench } from './use-workbench';
import { WorkbenchViewBody, type WorkbenchViewContext } from './workbench-views';
import { MORE_VIEWS, PANEL_VIEW_LABELS, PRIMARY_VIEWS, type PanelView } from './workbench-state';
import { Tip } from '@/components/ui/tip';
import { BesideFileTab } from '@/components/chat-ui/artifacts/artifact-beside';
import { PanelWindowControls, panelTabClass } from './panel-strip';

export const VIEW_ICONS: Record<PanelView, React.ComponentType<{ size?: number; className?: string }>> = {
  run: Play,
  preview: AppWindow,
  changes: GitCompareArrows,
  files: FileText,
  notes: ListTodo,
  scratch: NotebookPen,
  file: File,
};

interface WorkbenchPanelProps {
  workbench: Workbench;
  ctx: WorkbenchViewContext;
  /** Tab badges. */
  changedFiles: number | null;
  linkedCount: number;
  scratchHasContent: boolean;
}

/**
 * The right-hand panel. Its header navigates: Run · Preview · Changes ·
 * Files as tabs, Notes & tasks and Scratchpad under More (which takes the
 * name of whichever is open), then the file opened from the chat as its own
 * tab while there is one, then expand and close. A jump from the chat or
 * from one view into another shows a "‹ Changes" pill to go back.
 *
 * Views stay mounted once visited while the panel is open, so switching
 * tabs keeps the preview loaded, the open file in place, and the output
 * scrolled where it was.
 */
export function WorkbenchPanel({ workbench, ctx, changedFiles, linkedCount, scratchHasContent }: WorkbenchPanelProps) {
  const { state, dispatch, show, jump } = workbench;
  const view = state.view;
  const [visited, setVisited] = useState<ReadonlySet<PanelView>>(() => new Set(view ? [view] : []));
  // Derived during render (React's pattern for state that follows a prop),
  // so a newly opened view mounts in the same pass instead of a frame later.
  if (view && !visited.has(view)) setVisited(new Set(visited).add(view));

  if (!view) return null;

  const status = ctx.controller.runStatus;
  const moreActive = MORE_VIEWS.includes(view);
  const MoreIcon = moreActive ? VIEW_ICONS[view] : MoreHorizontal;

  return (
    <div className="@container/panel flex h-full min-w-0 flex-col bg-background">
      <div className="flex h-9 flex-shrink-0 items-stretch gap-0.5 border-b border-border pl-1 pr-1.5">
        {PRIMARY_VIEWS.map((v) => {
          const Icon = VIEW_ICONS[v];
          const on = view === v;
          return (
            <Tip key={v} label={PANEL_VIEW_LABELS[v]} onlyWhenTextHidden>
              <button
                type="button"
                data-tab={v}
                onClick={() => show(v)}
                onDoubleClick={() => dispatch({ type: 'toggleMaximize' })}
                aria-pressed={on}
                className={cn('flex items-center gap-1.5', panelTabClass(on))}
              >
                <Icon size={13} />
                <span className="@max-[560px]/panel:hidden">{PANEL_VIEW_LABELS[v]}</span>
                {v === 'run' && status !== 'stopped' && status !== 'not-configured' && status !== 'elsewhere' && (
                  <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', runDotClass(status))} />
                )}
                {v === 'changes' && !!changedFiles && (
                  <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground/70">{changedFiles}</span>
                )}
              </button>
            </Tip>
          );
        })}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Tip label="Notes & tasks, Scratchpad">
              <button
                className={cn('flex items-center gap-1.5 outline-none', panelTabClass(moreActive))}
              >
                <MoreIcon size={13} />
                <span className="@max-[560px]/panel:hidden">{moreActive ? PANEL_VIEW_LABELS[view] : 'More'}</span>
                <ChevronDown size={12} className="opacity-70" />
              </button>
            </Tip>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={4} className="min-w-52">
            {MORE_VIEWS.map((v) => {
              const Icon = VIEW_ICONS[v];
              return (
                <DropdownMenuItem key={v} onClick={() => show(v)} className={cn(view === v && 'bg-accent')}>
                  <Icon size={14} />
                  {PANEL_VIEW_LABELS[v]}
                  <span className="ml-auto pl-4 text-[11px] text-muted-foreground">
                    {v === 'notes' && linkedCount > 0 && `${linkedCount} linked`}
                    {v === 'scratch' && scratchHasContent && (
                      <span aria-label="Has notes" className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/70" />
                    )}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        {/* Opening it is a jump, from the chat or from here, so closing it goes back to what it covered. */}
        <BesideFileTab
          host={ctx.besideHost}
          active={view === 'file'}
          onSelect={() => jump('file')}
          className={cn('gap-0.5', panelTabClass(view === 'file'))}
        />

        <span className="flex-1" />
        <PanelWindowControls
          maximized={state.maximized}
          onToggleMaximize={() => dispatch({ type: 'toggleMaximize' })}
          onClose={() => dispatch({ type: 'close' })}
        />
      </div>

      {state.from && (
        <div className="flex h-8 flex-shrink-0 items-center border-b border-border px-2">
          <Tip label={`Back to ${PANEL_VIEW_LABELS[state.from]}`}>
            <button
              type="button"
              onClick={() => dispatch({ type: 'back' })}
              className="inline-flex h-6 items-center gap-0.5 rounded-full bg-muted/70 pl-1 pr-2.5 text-[11.5px] font-medium text-foreground/85 transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft size={13} />
              {PANEL_VIEW_LABELS[state.from]}
            </button>
          </Tip>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {[...visited].map((v) => (
          <div
            key={v}
            inert={v !== view}
            aria-hidden={v !== view}
            className={cn('absolute inset-0', v !== view && 'pointer-events-none opacity-0')}
          >
            <WorkbenchViewBody view={v} ctx={ctx} />
          </div>
        ))}
      </div>
    </div>
  );
}
