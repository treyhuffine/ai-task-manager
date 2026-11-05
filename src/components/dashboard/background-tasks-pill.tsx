'use client';

import { useState } from 'react';
import { Boxes, Info } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { AgentIcon } from '@/components/agents/agent-icon';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tip } from '@/components/ui/tip';
import type { RailResponse } from '@/lib/api/sessions';
import { executionView } from '@/lib/client/active-view';
import { cn } from '@/lib/utils';

/** Global visibility for detached work. The chat's existing strip owns task details. */
export function BackgroundTasksPill({ chats }: { chats: RailResponse['backgroundChats'] }) {
  const [open, setOpen] = useState(false);
  const { activeSessionId, setActiveView } = useDashboard();
  const count = chats.reduce((sum, chat) => sum + chat.taskCount, 0);
  if (!count) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Tip label="Background tasks">
          <button
            type="button"
            aria-label={`Background tasks: ${count}`}
            className="flex h-[18px] items-center gap-1 rounded bg-sky-500/15 px-1.5 text-[10px] text-sky-600 transition-[filter] hover:brightness-110 data-[state=open]:brightness-110 dark:text-sky-400 dark:hover:brightness-125 dark:data-[state=open]:brightness-125"
          >
            <Boxes aria-hidden size={10} />
            <span className="font-mono font-semibold tabular-nums">{count}</span>
          </button>
        </Tip>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-72 overflow-hidden p-0">
        <div className="flex items-center gap-1.5 border-b border-border/40 bg-sky-500/[0.06] px-3 py-2 text-sky-600 dark:text-sky-400">
          <Boxes aria-hidden size={13} />
          <span className="flex-1 text-[10.5px] font-bold uppercase tracking-[0.12em]">Background tasks</span>
          <span className="rounded-full bg-sky-500/15 px-1.5 font-mono text-[9.5px] font-bold tabular-nums">{count}</span>
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {chats.map(chat => {
            const label = chat.label ?? chat.executionLabel ?? chat.workspaceName ?? 'Main chat';
            const location = chat.location && !chat.location.isHome ? chat.location.name : 'This server';
            return (
              <Tip key={chat.id} label={label} onlyWhenTextHidden>
                <button
                  type="button"
                  onClick={() => {
                    setActiveView(executionView(chat.id));
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-start gap-1.5 rounded-md px-2.5 py-1.5 text-left transition-colors',
                    activeSessionId === chat.id ? 'bg-secondary' : 'hover:bg-muted/50',
                  )}
                >
                  <AgentIcon workspace={{ name: chat.workspaceName ?? 'Main chat', emoji: chat.workspaceEmoji, attachments: chat.workspaceAttachments, areaId: chat.workspaceAreaId }} size="sm" />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-[11.5px] font-medium text-foreground/90">{label}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-muted-foreground/70">
                      {chat.workspaceName ? `${chat.workspaceName} · ` : ''}{location}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] text-sky-600 dark:text-sky-400">
                    {chat.taskCount} {chat.taskCount === 1 ? 'task' : 'tasks'}
                  </span>
                </button>
              </Tip>
            );
          })}
        </div>
        <p className="flex items-start gap-1.5 border-t border-border/40 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
          <Info aria-hidden className="mt-0.5 size-3 shrink-0" />
          Restarting Ri interrupts background tasks running on this server.
        </p>
      </PopoverContent>
    </Popover>
  );
}
