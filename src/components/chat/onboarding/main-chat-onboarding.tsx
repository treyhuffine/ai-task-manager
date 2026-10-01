'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, ArrowUp, FolderPlus, Loader2, PenLine } from 'lucide-react';
import { toast } from 'sonner';
import { APP_NAME } from '@/constants/app';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { ThinkingDots } from '@/components/executions/thinking-dots';
import { OrchestratorAvatar } from '@/components/shared/orchestrator-mark';
import {
  IdentityEditor,
  draftFromState,
  draftName,
  useSaveIdentity,
  type IdentityDraft,
} from '@/components/orchestrator/identity-editor';
import { WorkspaceCreateModal } from '@/components/workspaces/workspace-create-modal';
import { appMainChatIntro, useEmptyChatActions } from '@/components/chat/main-chat-intro';
import { useOrchestratorIdentity, useUpdateUserState, useUserState } from '@/hooks/use-user-state';
import { useWorkspaces } from '@/hooks/use-workspaces';
import { apiErrorText } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { OnboardingApps } from './onboarding-apps';
import {
  FIRST_PROGRESS,
  PROGRESS_STORAGE_KEY,
  nextStep,
  readProgress,
  stepsThrough,
  type OnboardingProgress,
  type OnboardingStep,
} from './onboarding-flow';

/** How long the assistant "types" before a new step appears. */
const TYPING_MS = 650;

/**
 * The main chat's first run: the orchestrator introduces itself and sets up
 * the few things worth asking a person about, one message at a time, the way
 * a conversation would. Its name and look, what to call you, what you're
 * working on, the apps it can work in, and (for someone with none) a first
 * agent. Then it hands over to the usual starters.
 *
 * The messages are scripted and drawn with the transcript's own components,
 * not stored as chat events. The real conversation with the harness starts
 * clean, nothing waits on a model, and every answer lands in the settings the
 * orchestrator already reads (its brief, user state), so it knows them all
 * the same. See docs/main-chat-onboarding.md.
 *
 * Progress is kept per browser, so a reload or a connector's sign-in redirect
 * comes back to the same step. Finishing or skipping records
 * `orchestratorIntroducedAt`, and the chat opens on the usual intro after.
 */
export function MainChatOnboarding({ onSkip }: { onSkip: () => void }) {
  const { data: userState } = useUserState();
  const { data: workspaces } = useWorkspaces({ status: 'active' });
  const update = useUpdateUserState();
  const [progress, setProgress] = useState<OnboardingProgress>(FIRST_PROGRESS);
  const [hydrated, setHydrated] = useState(false);
  const [typing, setTyping] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Read once, after mount: localStorage isn't there during server render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProgress(readProgress(window.localStorage.getItem(PROGRESS_STORAGE_KEY)));
    setHydrated(true);
  }, []);

  const hasAgents = (workspaces?.length ?? 0) > 0;
  const finished = progress.step === 'done';

  // Reaching the end is finishing: record it once, so the next empty chat
  // opens on the usual intro. This chat keeps the conversation until it's used.
  const recorded = useRef(false);
  useEffect(() => {
    if (!finished || recorded.current || userState?.orchestratorIntroducedAt) return;
    recorded.current = true;
    update.mutate({ orchestratorIntroducedAt: new Date().toISOString() });
  }, [finished, update, userState?.orchestratorIntroducedAt]);

  const advance = (step: OnboardingStep, reply: string) => {
    const next: OnboardingProgress = {
      step: nextStep(step, { hasAgents }),
      replies: { ...progress.replies, [step]: reply },
    };
    setProgress(next);
    try {
      window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage off: the conversation still works, minus resuming.
    }
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setTyping(true);
  };

  useEffect(() => {
    if (!typing) return;
    const t = setTimeout(() => setTyping(false), TYPING_MS);
    return () => clearTimeout(t);
  }, [typing]);

  // Keep the newest message in view as the conversation grows: a new step,
  // and a step whose card fills in after it appears (the apps load, search
  // results open).
  const columnRef = useRef<HTMLDivElement>(null);
  const ready = hydrated && !!userState;
  useEffect(() => {
    const column = columnRef.current;
    if (!column) return;
    let height = column.offsetHeight;
    const observer = new ResizeObserver(() => {
      const grew = column.offsetHeight > height;
      height = column.offsetHeight;
      if (grew) endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    });
    observer.observe(column);
    return () => observer.disconnect();
  }, [ready]);

  const skip = () => {
    try {
      window.localStorage.removeItem(PROGRESS_STORAGE_KEY);
    } catch {
      // ignore
    }
    update.mutate({ orchestratorIntroducedAt: new Date().toISOString() });
    onSkip();
  };

  if (!hydrated || !userState) return <div className="flex-1" />;

  const steps = stepsThrough(progress.step, progress.replies);
  const userName = userState.name?.trim() || null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div ref={columnRef} className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-5 pt-4 pb-8">
        {!finished && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={skip}
              className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              Skip setup
            </button>
          </div>
        )}

        {steps.map((step) => {
          const current = step === progress.step;
          if (current && typing) return <Typing key={`${step}-typing`} />;
          const reply = progress.replies[step];
          return (
            <div key={step} className={cn('flex flex-col gap-3', current && 'animate-in fade-in-0 slide-in-from-bottom-1 duration-300')}>
              <Turn>
                {/* The greeting and the first question are one turn. */}
                {step === 'identity' && <Greeting />}
                {lines(step, progress.replies, userName)}
              </Turn>
              {reply !== undefined ? (
                <Reply step={step}>{reply}</Reply>
              ) : step === 'identity' ? (
                <IdentityStep onDone={(name) => advance('identity', name)} />
              ) : step === 'you' ? (
                <YouStep initial={userState.name ?? ''} onDone={(name) => advance('you', name)} />
              ) : step === 'about' ? (
                <AboutStep initial={userState.description ?? ''} onDone={(text) => advance('about', text)} />
              ) : step === 'apps' ? (
                <OnboardingApps onDone={(summary) => advance('apps', summary)} />
              ) : step === 'agent' ? (
                <AgentStep onDone={(summary) => advance('agent', summary)} />
              ) : (
                <Starters />
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function Greeting() {
  return (
    <>
      <Says>Hi, welcome to {APP_NAME}.</Says>
      <Says>
        I’m the one you talk to here. I keep your tasks, notes and deck in order, and I start your agents and
        keep an eye on their work. Let’s set a few things up. It takes a minute.
      </Says>
    </>
  );
}

/** What the assistant says at a step, given what was answered before it. */
function lines(step: OnboardingStep, replies: OnboardingProgress['replies'], userName: string | null): ReactNode {
  switch (step) {
    case 'identity':
      return (
        <Says>
          First, what should I go by? Pick a name and a look, or start from one of these. You can change both any
          time.
        </Says>
      );
    case 'you':
      return (
        <>
          <Says>{replies.identity ? `${replies.identity} it is.` : 'Good.'}</Says>
          <Says>And what should I call you?</Says>
        </>
      );
    case 'about':
      return (
        <>
          <Says>{userName ? `Nice to meet you, ${userName}.` : 'Nice to meet you.'}</Says>
          <Says>
            What are you working on these days? A line or two helps me plan your days, and your agents get the
            context too.
          </Says>
        </>
      );
    case 'apps':
      return (
        <>
          <Says>{replies.about === SKIPPED ? 'No problem. Tell me any time.' : 'Thanks, that helps.'}</Says>
          <Says>
            Want me to work in the apps you already use? Connect them and I can read and act in them for you. I
            check with you before I send anything or do anything that can’t be undone.
          </Says>
        </>
      );
    case 'agent':
      return (
        <Says>
          One more thing. Your agents work in folders on your computer, like a code repo or a folder of
          documents. Add one and I can start work there for you.
        </Says>
      );
    case 'done':
      return (
        <>
          <Says>{userName ? `You’re all set, ${userName}.` : 'You’re all set.'}</Says>
          <Says>Ask me anything below, or start with one of these.</Says>
        </>
      );
  }
}

const SKIPPED = 'Skip for now';

// ─── Conversation pieces ──────────────────────────────────────

/** One run of the assistant's messages, under its avatar and name. */
function Turn({ children }: { children: ReactNode }) {
  const { name } = useOrchestratorIdentity();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <OrchestratorAvatar size="sm" />
        <span className="text-[11px] font-semibold text-foreground/80">{name}</span>
      </div>
      {children}
    </div>
  );
}

function Says({ children }: { children: ReactNode }) {
  return (
    <Message from="assistant">
      <MessageContent className="text-[12.5px] leading-relaxed">{children}</MessageContent>
    </Message>
  );
}

/** The user's answer, as their message. The name step shows the face it picked. */
function Reply({ step, children }: { step: OnboardingStep; children: ReactNode }) {
  return (
    <Message from="user">
      <MessageContent className="whitespace-pre-wrap break-words text-[12.5px]">
        {step === 'identity' ? (
          <span className="inline-flex items-center gap-1.5">
            <OrchestratorAvatar size="xs" />
            {children}
          </span>
        ) : (
          children
        )}
      </MessageContent>
    </Message>
  );
}

function Typing() {
  return (
    <div className="flex flex-col gap-1.5">
      <OrchestratorAvatar size="sm" />
      <div className="pl-0.5 text-muted-foreground">
        <ThinkingDots />
      </div>
    </div>
  );
}

/** The card a step asks its question with. */
function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-border bg-card/60 p-3 shadow-sm', className)}>{children}</div>
  );
}

function PrimaryButton({
  children,
  disabled,
  busy,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
    >
      {busy && <Loader2 size={12} className="animate-spin" />}
      {children}
    </button>
  );
}

function QuietButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
    >
      {children}
    </button>
  );
}

// ─── Steps ────────────────────────────────────────────────────

function IdentityStep({ onDone }: { onDone: (name: string) => void }) {
  const { data: userState } = useUserState();
  const [draft, setDraft] = useState<IdentityDraft>(() => draftFromState(userState));
  const { save, saving } = useSaveIdentity();
  const submit = async () => {
    if (await save(draft)) onDone(draftName(draft));
  };
  return (
    <Card>
      <IdentityEditor draft={draft} onChange={setDraft} onSubmit={() => void submit()} />
      <div className="mt-3 flex justify-end">
        <PrimaryButton busy={saving} onClick={() => void submit()}>
          Continue <ArrowRight size={12} />
        </PrimaryButton>
      </div>
    </Card>
  );
}

function YouStep({ initial, onDone }: { initial: string; onDone: (name: string) => void }) {
  const update = useUpdateUserState();
  const [name, setName] = useState(initial);
  const trimmed = name.trim();
  const submit = () => {
    if (!trimmed) return;
    update.mutate(
      { name: trimmed },
      {
        onSuccess: () => onDone(trimmed),
        onError: (err) => toast.error('Couldn’t save your name', { description: apiErrorText(err) }),
      },
    );
  };
  return (
    <Card className="flex items-center gap-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Your name"
        aria-label="Your name"
        className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <PrimaryButton disabled={!trimmed} busy={update.isPending} onClick={submit}>
        Continue <ArrowRight size={12} />
      </PrimaryButton>
    </Card>
  );
}

function AboutStep({ initial, onDone }: { initial: string; onDone: (text: string) => void }) {
  const update = useUpdateUserState();
  const [text, setText] = useState(initial);
  const trimmed = text.trim();
  const submit = () => {
    update.mutate(
      { description: trimmed },
      {
        onSuccess: () => onDone(trimmed || SKIPPED),
        onError: (err) => toast.error('Couldn’t save that', { description: apiErrorText(err) }),
      },
    );
  };
  return (
    <Card>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        rows={3}
        placeholder="Running a small product studio, shipping a new app, training for a marathon…"
        aria-label="What you're working on"
        className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="mt-2 flex items-center justify-end gap-1.5">
        {!trimmed && <QuietButton onClick={() => onDone(SKIPPED)}>Skip for now</QuietButton>}
        <PrimaryButton disabled={!trimmed} busy={update.isPending} onClick={submit}>
          Continue <ArrowRight size={12} />
        </PrimaryButton>
      </div>
    </Card>
  );
}

/**
 * For someone with no agents yet: the same New agent dialog the rail uses.
 * Finishes on its own once an agent appears.
 */
function AgentStep({ onDone }: { onDone: (summary: string) => void }) {
  const { data: workspaces } = useWorkspaces({ status: 'active' });
  const [open, setOpen] = useState(false);
  // The agents there were when the step appeared, so a new one stands out.
  const [before, setBefore] = useState<Set<string> | null>(null);
  if (workspaces && before === null) setBefore(new Set(workspaces.map((w) => w.id)));

  const added = before ? workspaces?.find((w) => !before.has(w.id)) : undefined;
  const doneRef = useRef(false);
  useEffect(() => {
    if (!added || doneRef.current) return;
    doneRef.current = true;
    onDone(`Added ${added.name}`);
  }, [added, onDone]);

  return (
    <Card className="flex items-center justify-end gap-1.5">
      <QuietButton onClick={() => onDone('Later')}>Later</QuietButton>
      <PrimaryButton onClick={() => setOpen(true)}>
        <FolderPlus size={12} /> Add an agent
      </PrimaryButton>
      <WorkspaceCreateModal open={open} onOpenChange={setOpen} />
    </Card>
  );
}

/** The usual starters, as the conversation's last word. */
function Starters() {
  const actions = useEmptyChatActions();
  const { starters } = appMainChatIntro();
  return (
    <div className="flex flex-wrap gap-1.5">
      {starters.map((s) => (
        <button
          key={s.label}
          type="button"
          disabled={actions.disabled}
          onClick={() => (s.draft ? actions.draft(s.prompt) : actions.send(s.prompt))}
          title={s.draft ? 'Start this in the composer' : 'Send this'}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12px] text-foreground/90 transition-colors hover:bg-muted/60 disabled:opacity-50"
        >
          {s.draft ? <PenLine size={11} className="text-muted-foreground" /> : <ArrowUp size={11} className="text-muted-foreground" />}
          {s.label}
        </button>
      ))}
    </div>
  );
}
