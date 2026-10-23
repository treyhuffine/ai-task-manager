'use client';

import { Command } from 'cmdk';
import { Bot, ChevronDown, Search } from 'lucide-react';
import type { WorkspaceRecord } from '@/db/types';
import { cn } from '@/lib/utils';
import { AgentIcon } from '@/components/agents/agent-icon';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { LauncherPopoverContent } from './launcher/launcher-popover';

export function WorkspacePicker({
  workspaces,
  workspaceId,
  open,
  onOpenChange,
  onChange,
}: {
  workspaces: Pick<WorkspaceRecord, 'id' | 'name' | 'emoji' | 'attachments' | 'areaId'>[];
  workspaceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (id: string) => void;
}) {
  const current = workspaces.find((w) => w.id === workspaceId);

  // The existing fixed-position dialog popover keeps filtering, keyboard
  // selection and scrolling within the current modal boundary.
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] font-semibold transition-colors',
            current
              ? 'text-foreground hover:bg-muted/60'
              : 'border border-dashed border-primary/50 text-primary hover:bg-primary/5',
          )}
        >
          {current ? <AgentIcon workspace={current} size="xs" /> : <Bot size={12} className="text-primary/80" />}
          {current?.name ?? 'Pick an agent'}
          <ChevronDown size={11} className={current ? 'text-muted-foreground/60' : 'text-primary/70'} />
        </button>
      </PopoverTrigger>
      {/* Radix focuses the first field on open, which is the filter, so
          typing narrows the list straight away. */}
      <LauncherPopoverContent align="start" className="w-64 p-0">
        <Command loop className="flex flex-col">
          <div className="flex items-center gap-1.5 border-b border-border px-2.5">
            <Search size={11} className="flex-shrink-0 text-muted-foreground/60" />
            <Command.Input
              placeholder="Find an agent…"
              className="h-8 flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/50"
            />
          </div>
          <Command.List className="max-h-64 overflow-y-auto p-1">
            <Command.Empty className="px-2 py-3 text-center text-[11px] text-muted-foreground">
              No agent by that name
            </Command.Empty>
            {workspaces.map((w) => (
              <Command.Item
                key={w.id}
                value={`${w.name} ${w.id}`}
                onSelect={() => {
                  onChange(w.id);
                  onOpenChange(false);
                }}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-foreground/90',
                  'data-[selected=true]:bg-muted/70 data-[selected=true]:text-foreground',
                  w.id === workspaceId && 'font-medium text-foreground',
                )}
              >
                <AgentIcon workspace={w} size="xs" />
                <span className="truncate">{w.name}</span>
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </LauncherPopoverContent>
    </Popover>
  );
}

