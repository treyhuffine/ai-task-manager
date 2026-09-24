'use client';

import { ChevronLeft, MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { sessionFolder } from '@/lib/folders/source';
import { cn } from '@/lib/utils';
import { FileTree } from '../file-tree/file-tree';
import { FileViewer } from '../viewer/file-viewer';
import { ToolsList, type ToolsListProps } from './tools-box';
import { VIEW_ICONS } from './workbench-panel';
import { WorkbenchViewBody, type WorkbenchViewContext } from './workbench-views';
import { MORE_VIEWS, PANEL_VIEW_LABELS, PRIMARY_VIEWS, type PanelView } from './workbench-state';

/**
 * The phone's Tools sheet: the same list as the desktop box, with touch
 * sized rows. No terminal here, since the phone is a thin client.
 */
export function MobileToolsSheet({
  open,
  onOpenChange,
  ...list
}: Omit<ToolsListProps, 'terminal' | 'touch'> & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" showCloseButton={false} className="max-h-[88dvh] rounded-t-2xl px-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">
        <SheetTitle className="sr-only">Tools</SheetTitle>
        <div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-muted-foreground/30" />
        <div className="overflow-y-auto">
          <ToolsList {...list} touch />
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface MobileDestinationProps {
  view: PanelView;
  ctx: WorkbenchViewContext;
  onShow: (view: PanelView) => void;
  onBack: () => void;
  /** This chat is waiting on the user: keep the way back one tap away. */
  needsInput: boolean;
}

/**
 * A tool opened on the phone, full width. A compact selector moves between
 * Run · Preview · Changes · Files, with Notes & tasks and Scratchpad under
 * ⋯. "‹ Chat" goes back. If the chat needs an answer meanwhile, a bar at
 * the bottom says so and takes you straight back to it.
 */
export function MobileDestination({ view, ctx, onShow, onBack, needsInput }: MobileDestinationProps) {
  const moreActive = MORE_VIEWS.includes(view);
  return (
    <div className="relative flex h-full min-h-0 w-full flex-col bg-background">
      <div className="flex flex-shrink-0 items-center gap-1 border-b border-border px-1.5 py-2">
        <button
          type="button"
          onClick={onBack}
          className="flex h-9 flex-shrink-0 items-center gap-0.5 rounded-md pl-1 pr-2 text-[14px] text-foreground/90 active:bg-muted/50"
        >
          <ChevronLeft size={18} />
          Chat
        </button>
        <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-lg bg-muted/60 p-0.5">
          {PRIMARY_VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onShow(v)}
              className={cn(
                'flex-shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                view === v ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
              )}
            >
              {PANEL_VIEW_LABELS[v]}
            </button>
          ))}
          {moreActive && (
            <span className="flex-shrink-0 whitespace-nowrap rounded-md bg-background px-2.5 py-1.5 text-[13px] font-medium text-foreground shadow-sm">
              {PANEL_VIEW_LABELS[view]}
            </span>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Notes & tasks, Scratchpad"
            className="flex size-9 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none active:bg-muted/50"
          >
            <MoreHorizontal size={17} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="min-w-48">
            {MORE_VIEWS.map((v) => {
              const Icon = VIEW_ICONS[v];
              return (
                <DropdownMenuItem key={v} onClick={() => onShow(v)}>
                  <Icon size={14} />
                  {PANEL_VIEW_LABELS[v]}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="relative min-h-0 flex-1">
        {view === 'files' && !ctx.settingUp ? <PhoneFiles ctx={ctx} /> : <WorkbenchViewBody view={view} ctx={ctx} />}
      </div>

      {needsInput && (
        <div className="absolute inset-x-2.5 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 flex items-center gap-3 rounded-2xl bg-amber-950/95 py-2.5 pl-4 pr-2.5 text-amber-50 shadow-lg ring-1 ring-amber-500/40">
          <span aria-hidden className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-amber-400" />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-semibold text-amber-300">Needs input</div>
            <div className="truncate text-[12.5px] text-amber-50/85">This chat is waiting on your answer.</div>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="flex-shrink-0 rounded-lg bg-amber-50 px-3 py-1.5 text-[13px] font-semibold text-amber-950 active:bg-amber-100"
          >
            Answer
          </button>
        </div>
      )}
    </div>
  );
}

/** Files on a phone: the tree, or the file full width. Side by side doesn't fit. */
function PhoneFiles({ ctx }: { ctx: WorkbenchViewContext }) {
  const source = sessionFolder(ctx.sessionId);
  return ctx.selectedPath ? (
    <FileViewer source={source} selectedPath={ctx.selectedPath} onClose={() => ctx.onSelectFile(null)} />
  ) : (
    <FileTree
      source={source}
      worktreeId={ctx.worktreeId}
      selectedPath={null}
      onSelect={ctx.onSelectFile}
      worktreePath={ctx.worktreePath}
    />
  );
}
