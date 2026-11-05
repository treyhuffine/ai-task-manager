'use client';

import { Boxes, Info } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { AgentIcon } from '@/components/agents/agent-icon';
import { Tip } from '@/components/ui/tip';
import type { RailResponse } from '@/lib/api/sessions';
import { executionView } from '@/lib/client/active-view';
import { cn } from '@/lib/utils';
import { StatusPill } from './status-pill';

/** Global visibility for detached work. The chat's existing strip owns task details. */
export function BackgroundTasksPill({ chats }: { chats: RailResponse['backgroundChats'] }) {
  const { activeSessionId, setActiveView } = useDashboard();
  const count = chats.reduce((sum, chat) => sum + chat.taskCount, 0);
  return (
    <StatusPill
      label="Background tasks"
      count={count}
      icon={<Boxes aria-hidden size={13} className="text-sky-500" />}
      accentClass="text-sky-600 dark:text-sky-400"
      countBgClass="bg-sky-500/15 text-sky-600 dark:text-sky-400"
      headerBgClass="bg-sky-500/[0.06]"
      footer={(
        <p className="flex items-start gap-1.5 border-t border-border/40 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
          <Info aria-hidden className="mt-0.5 size-3 shrink-0" />
          Restarting Ri interrupts background tasks running on this server.
        </p>
      )}
    >
      {(close) => (
        <>
          {chats.map(chat => {
            const label = chat.label ?? chat.executionLabel ?? chat.workspaceName ?? 'Main chat';
            const location = chat.location && !chat.location.isHome ? chat.location.name : 'This server';
            return (
              <Tip key={chat.id} label={label} onlyWhenTextHidden>
                <button
                  type="button"
                  onClick={() => {
                    setActiveView(executionView(chat.id));
                    close();
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
        </>
      )}
    </StatusPill>
  );
}
