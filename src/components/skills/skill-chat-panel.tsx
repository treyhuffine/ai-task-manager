'use client';

import { useState } from 'react';
import { Loader2, Plus, RefreshCw } from 'lucide-react';
import { HarnessChatSession } from '@/components/chat/harness-chat';
import type { MainChatIntro } from '@/components/chat/main-chat-intro';
import type { SkillView } from '@/lib/api/skills';
import { cn } from '@/lib/utils';
import { useSkillChat, type SkillChatKind } from './use-skill-chat';
import { Tip } from '@/components/ui/tip';

function buildIntro(skill: SkillView): MainChatIntro {
  const empty = !skill.description?.trim() && !skill.body.trim();
  return {
    title: empty ? 'What should this skill do?' : `Work on ${skill.name} together`,
    description:
      'Explain it the way you would to a new teammate: when it comes up, what good looks like, what to watch out for. The AI writes it into the editor, and you can change anything there.',
    starters: empty
      ? [{ label: 'Describe what it does', prompt: 'This skill should ', draft: true }]
      : [
          { label: 'Write a full draft', prompt: 'Write a complete draft of this skill from what is there now, then ask me what is missing.' },
          { label: 'Sharpen when it’s used', prompt: 'Rewrite the description so an agent reliably knows when to use this skill, and when not to.' },
          { label: 'Review it', prompt: 'Review this skill the way an expert skill author would. What would make agents follow it more reliably?' },
          { label: 'Suggest a test', prompt: 'Suggest three realistic messages I could send in the Try it tab to test this skill, including one where it should not trigger.' },
        ],
  };
}

function tryIntro(skill: SkillView): MainChatIntro {
  return {
    title: 'Try it the way you’d use it',
    description:
      `This chat has ${skill.name}. Ask for something it should handle, in your own words, and watch whether the agent picks it up.`,
    starters: [{ label: 'Ask something it should handle', prompt: '', draft: true }],
  };
}

const TABS: Array<{ kind: SkillChatKind; label: string }> = [
  { kind: 'build', label: 'Build' },
  { kind: 'try', label: 'Try it' },
];

/**
 * The skill builder's chat side. Build is the chat that writes the skill
 * with you (briefed on it, see src/lib/skills/builder-brief.ts). Try it is
 * an ordinary chat that has the skill attached, wherever it lives, so you
 * can see whether an agent reaches for it. Each tab keeps its own thread.
 */
export function SkillChatPanel({ skill }: { skill: SkillView }) {
  // A skill linked in from elsewhere is edited where it lives, so it can
  // only be tried here.
  const tabs = skill.editable ? TABS : TABS.filter((t) => t.kind === 'try');
  const [tab, setTab] = useState<SkillChatKind>(tabs[0].kind);
  const [visited, setVisited] = useState<Set<SkillChatKind>>(() => new Set([tabs[0].kind]));
  const build = useSkillChat(skill.ref, 'build', { enabled: skill.editable });
  const tryChat = useSkillChat(skill.ref, 'try', { enabled: visited.has('try') });
  const chats = { build, try: tryChat };
  const active = chats[tab];

  // A try started before the skill last changed may be running the old
  // description (harnesses read it at the start), so offer a fresh one.
  const tryStale =
    tryChat.session !== null && new Date(skill.updatedAt).getTime() > new Date(tryChat.session.createdAt).getTime() + 1000;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3 py-1">
        <div role="tablist" aria-label="Build or try" className="flex items-center gap-0.5">
          {tabs.map(({ kind, label }) => (
            <button
              key={kind}
              role="tab"
              aria-selected={tab === kind}
              onClick={() => {
                setTab(kind);
                setVisited((prev) => (prev.has(kind) ? prev : new Set(prev).add(kind)));
              }}
              className={cn(
                'flex items-center gap-1 rounded-md px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.06em] transition-colors',
                tab === kind ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
              {chats[kind].isActive && <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />}
            </button>
          ))}
        </div>
        <Tip label={tab === 'build' ? 'Start a new builder chat (archives this one)' : 'Start a new try (archives this one)'}>
          <button
            onClick={() => active.newChat.mutate()}
            disabled={active.newChat.isPending || !active.sessionId}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground transition-all hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
          >
            {active.newChat.isPending ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
            New
          </button>
        </Tip>
      </div>

      {tabs.filter(({ kind }) => visited.has(kind)).map(({ kind }) => {
        const chat = chats[kind];
        return (
          <div key={kind} inert={tab !== kind} className={cn('min-h-0 flex-1 flex-col', tab === kind ? 'flex' : 'hidden')}>
            {kind === 'try' && tryStale && (
              <div className="flex shrink-0 items-center gap-2 border-b border-border/50 bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
                <span className="flex-1">The skill changed since this try started.</span>
                <button
                  onClick={() => tryChat.newChat.mutate()}
                  className="rounded-md px-1.5 py-0.5 font-medium text-foreground hover:bg-muted"
                >
                  Try the latest
                </button>
              </div>
            )}
            {chat.sessionId ? (
              <HarnessChatSession
                key={chat.sessionId}
                sessionId={chat.sessionId}
                autoFocusComposer={kind === tab}
                composerPlaceholder={
                  kind === 'build' ? 'Tell the AI what this skill should do or change' : 'Ask for something the skill should handle'
                }
                intro={kind === 'build' ? buildIntro(skill) : tryIntro(skill)}
              />
            ) : chat.error ? (
              <div className="flex flex-1 items-center justify-center px-8 text-center">
                <div>
                  <p className="text-[12px] font-semibold text-foreground">Couldn&apos;t open this chat.</p>
                  <button
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
        );
      })}
    </div>
  );
}
