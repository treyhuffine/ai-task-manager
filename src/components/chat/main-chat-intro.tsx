'use client';

import { ArrowUp, PenLine } from 'lucide-react';
import { APP_NAME } from '@/constants/app';
import { cn } from '@/lib/utils';

/**
 * What an empty main chat shows instead of a blank column: a line on what
 * this chat is for and a few starters. Sending anything (a starter or a
 * typed message) replaces it with the transcript.
 *
 * A starter either sends as written, or, when it only makes sense with the
 * user's words after it, drops its text in the composer to finish.
 */
export interface MainChatStarter {
  label: string;
  prompt: string;
  /** Put `prompt` in the composer instead of sending it. */
  draft?: boolean;
}

export interface MainChatIntro {
  title: string;
  description: string;
  starters: MainChatStarter[];
}

/** The app's main chat. */
export function appMainChatIntro(): MainChatIntro {
  return {
    title: 'What should we work on?',
    description:
      `I keep your tasks, notes, deck and stream in order, and I can see and steer every agent’s work. Ask me to set ${APP_NAME} up the way you work, too.`,
    starters: [
      { label: 'What’s on my plate today?', prompt: 'What’s on my plate today?' },
      { label: 'What needs me across my agents?', prompt: 'What needs my attention across my agents right now?' },
      { label: 'Triage my stream', prompt: 'Triage my stream.' },
      { label: `Help me set up ${APP_NAME}`, prompt: `Help me set up ${APP_NAME} for how I work. Ask me what you need to know.` },
    ],
  };
}

/** One agent's main chat. */
export function agentMainChatIntro(name: string): MainChatIntro {
  return {
    title: `Tell ${name} what to build`,
    description:
      'Anything you ask it to build starts an execution you can watch, steer and review. Ask here about its work any time.',
    starters: [
      { label: 'Build something', prompt: 'Build ', draft: true },
      { label: 'What’s in flight?', prompt: 'What are this agent’s executions doing, and does any of them need me?' },
      { label: 'Suggest what to build next', prompt: 'Look around this folder and suggest what to build next.' },
    ],
  };
}

export function MainChatIntroPanel({
  intro,
  onSend,
  onDraft,
  disabled,
}: {
  intro: MainChatIntro;
  onSend: (prompt: string) => void;
  onDraft: (prompt: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto my-auto w-full max-w-md px-6 py-8">
        <h2 className="text-[15px] font-semibold text-foreground">{intro.title}</h2>
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{intro.description}</p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {intro.starters.map((s) => (
            <button
              key={s.label}
              type="button"
              disabled={disabled}
              onClick={() => (s.draft ? onDraft(s.prompt) : onSend(s.prompt))}
              title={s.draft ? 'Start this in the composer' : 'Send this'}
              className={cn(
                'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-left text-[11.5px] transition-colors disabled:opacity-50',
                s.draft
                  ? 'border-primary/30 bg-primary/5 text-primary hover:bg-primary/15'
                  : 'border-border text-foreground/85 hover:bg-muted/60 hover:text-foreground',
              )}
            >
              {s.draft ? <PenLine size={11} className="flex-shrink-0" /> : <ArrowUp size={11} className="flex-shrink-0 opacity-60" />}
              <span className="truncate">{s.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
