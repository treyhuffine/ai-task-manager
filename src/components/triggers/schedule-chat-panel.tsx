'use client';

import { Loader2, MessageCircleMore, Plus, RefreshCw } from 'lucide-react';
import { HarnessChatSession } from '@/components/chat/harness-chat';
import type { MainChatIntro } from '@/components/chat/main-chat-intro';
import { Tip } from '@/components/ui/tip';
import { NEW_SCHEDULE_REF } from '@/lib/triggers/schedule-chat';
import type { useScheduleChat } from './use-schedule-chat';

const NEW_INTRO: MainChatIntro = {
  title: 'Describe the schedule',
  description:
    'Say what should happen and when, the way you would tell a teammate. The AI sets it up in the form, and you can change anything there.',
  starters: [
    { label: 'Describe it', prompt: 'Every ', draft: true },
    { label: 'Weekday morning briefing', prompt: 'Every weekday at 8am, summarize my calendar and unread email, and flag anything urgent.' },
    { label: 'Weekly review', prompt: 'Every Friday at 4pm, review what I finished this week and what is still open.' },
  ],
};

const EDIT_INTRO: MainChatIntro = {
  title: 'Change this schedule',
  description: 'Ask for any change in your own words. The form updates when the AI is done.',
  starters: [
    { label: 'Change when it runs', prompt: 'Run it ', draft: true },
    { label: 'Rewrite the message', prompt: 'Rewrite the message so it is clearer for the agent that runs it, keeping what it does the same.' },
    { label: 'Explain it', prompt: 'In two lines, what does this schedule do and when does it next run?' },
  ],
};

/**
 * The chat beside a schedule's form in the Schedules window. It sets up a
 * new schedule or changes the one that's open, through the same actions
 * the form uses (src/lib/triggers/builder-brief.ts).
 */
export function ScheduleChatPanel({ chat, scheduleRef }: { chat: ReturnType<typeof useScheduleChat>; scheduleRef: string }) {
  const isNew = scheduleRef === NEW_SCHEDULE_REF;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
          <MessageCircleMore size={11} />
          Set it up by chat
          {chat.isActive && <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />}
        </span>
        <Tip label="Start over in a new chat (archives this one)">
          <button
            type="button"
            onClick={() => chat.newChat.mutate()}
            disabled={chat.newChat.isPending || !chat.sessionId}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground transition-all hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
          >
            {chat.newChat.isPending ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
            New
          </button>
        </Tip>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {chat.sessionId ? (
          <HarnessChatSession
            key={chat.sessionId}
            sessionId={chat.sessionId}
            autoFocusComposer={isNew}
            composerPlaceholder={isNew ? 'What should run, and when?' : 'Ask for a change to this schedule'}
            intro={isNew ? NEW_INTRO : EDIT_INTRO}
          />
        ) : chat.error ? (
          <div className="flex flex-1 items-center justify-center px-8 text-center">
            <div>
              <p className="text-[12px] font-semibold text-foreground">Couldn&apos;t open this chat.</p>
              <button
                type="button"
                onClick={() => void chat.refetch()}
                className="mt-3 inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/10"
              >
                <RefreshCw size={11} /> Retry
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 size={16} className="animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
    </div>
  );
}
