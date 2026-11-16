'use client';

import { useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RailIconButton } from '@/components/workspaces/rail-icon-button';
import { FeedbackPanel } from './feedback-panel';
import { setFeedbackOpen, useFeedbackStore } from './feedback-store';
import { useVisualViewportBottom } from '@/hooks/use-visual-viewport-bottom';

/**
 * Rail footer trigger: a quiet borderless row when wide, or an icon button
 * when collapsed. Opens an anchored popover beside the footer so the user can
 * report what is on screen without losing context.
 */
export function FeedbackRailButton({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {collapsed ? (
          <RailIconButton
            icon={MessageSquarePlus}
            label="Feedback & bugs"
            hideTip={open}
            active={open}
          />
        ) : (
          <button
            type="button"
            aria-label="Feedback & bugs"
            aria-expanded={open}
            className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-colors"
          >
            <MessageSquarePlus size={13} className="shrink-0" />
            <span className="truncate">Feedback & bugs</span>
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="end"
        sideOffset={10}
        collisionPadding={12}
        className="flex max-h-[min(40rem,var(--radix-popover-content-available-height))] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden p-0"
      >
        <FeedbackPanel onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Dialog surface for Feedback & bugs when opened from the command palette or
 * phone More menu. Mounted once in the dashboard shell.
 */
export function FeedbackDialog() {
  const { open, returnFocus } = useFeedbackStore();
  const bottom = useVisualViewportBottom();

  return (
    <Dialog open={open} onOpenChange={setFeedbackOpen}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-1.5rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-md"
        style={
          bottom === null
            ? undefined
            : { top: `${bottom / 2}px`, maxHeight: `${Math.max(0, bottom - 24)}px` }
        }
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const fallback = document.querySelector<HTMLElement>('button[aria-label="Search"]');
          (returnFocus?.isConnected ? returnFocus : fallback)?.focus();
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Feedback & bugs</DialogTitle>
          <DialogDescription>Bugs, rough edges, or ideas</DialogDescription>
        </DialogHeader>
        <FeedbackPanel onClose={() => setFeedbackOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
