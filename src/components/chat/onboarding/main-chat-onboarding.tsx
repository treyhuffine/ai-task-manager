'use client';
import { trpcClient } from '@/lib/trpc/client';

import { appMainChatIntro, useEmptyChatActions } from '@/components/chat/main-chat-intro';
import {
	IdentityEditor,
	draftFromState,
	draftName,
	useSaveIdentity,
	type IdentityDraft,
} from '@/components/orchestrator/identity-editor';
import { WorkspaceCreateModal } from '@/components/workspaces/workspace-create-modal';
import { APP_NAME, APP_SHORT_ID } from '@/constants/app';
import { useAreas } from '@/hooks/use-areas';
import { useUpdateUserState, useUserState } from '@/hooks/use-user-state';
import { useWorkspaces } from '@/hooks/use-workspaces';
import { apiErrorText } from '@/lib/api/client';
import type { AreaSuggestion } from '@/lib/onboarding/area-suggestions';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ArrowUp, FolderPlus, PenLine } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useImportRun } from './import-runner';
import { ABOUT_SKIPPED, AboutStep, aboutQuestion, useAboutDraft } from './onboarding-about';
import { OnboardingApps } from './onboarding-apps';
import { AreasStep, NO_AREAS, areasLines, useAreaSuggestions } from './onboarding-areas';
import { DefaultModelLine } from './onboarding-default-model';
import {
	FIRST_PROGRESS,
	STEP_ORDER,
	nextStep,
	progressStorageKey,
	readProgress,
	stepApplies,
	stepsThrough,
	type OnboardingProgress,
	type OnboardingStep,
	type StepContext,
} from './onboarding-flow';
import { HarnessStep, harnessLines } from './onboarding-harness';
import {
	ImportProgress,
	ImportStep,
	importQuestion,
	importableHistory,
	recentProjects,
	useImportDiscovery,
	type ImportableHistory,
} from './onboarding-import';
import { Card, PrimaryButton, QuietButton, Reply, Says, Turn, Typing } from './onboarding-ui';
import { useHarnessCheck, type HarnessCheck } from './use-harness-check';

/** How long the assistant "types" before a new step appears. */
const TYPING_MS = 650;

/**
 * The main chat's first run, which is also a new home's whole setup: there
 * is no wizard in front of the app. The orchestrator introduces itself and
 * asks only what this home doesn't have yet, one message at a time:
 *
 *   its name and look → a harness to think with (only when the background
 *   check couldn't set one up, and either way a line saying which model and
 *   effort are now the default, with Change) → what to call you → what you're working on →
 *   history to bring in (only when some was found) → areas (only with none) →
 *   apps → a first agent (only with none) → the usual starters.
 *
 * The messages are scripted and drawn with the transcript's own components,
 * not stored as chat events. The real conversation with the harness starts
 * clean, and every answer lands in the settings the orchestrator already
 * reads (its brief, user state), so it knows them all the same. Three things
 * run in the background from the first message so the steps that need them
 * rarely wait: the harness check, the search for history, and (once you've
 * said what you're working on) area suggestions. See
 * docs/main-chat-onboarding.md.
 *
 * Progress is kept per browser, so a reload or a connector's sign-in redirect
 * comes back to the same step. Finishing or skipping records
 * `orchestratorIntroducedAt` (and `onboardedAt` for a new home), and the chat
 * opens on the usual intro after.
 */
export function MainChatOnboarding({ onSkip }: { onSkip: () => void }) {
  const { data: userState } = useUserState();
  const { data: workspaces } = useWorkspaces({ status: 'active' });
  const { data: areas } = useAreas();
  const update = useUpdateUserState();
  const [progress, setProgress] = useState<OnboardingProgress>(FIRST_PROGRESS);
  const [hydrated, setHydrated] = useState(false);
  const [typing, setTyping] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Progress is saved per home (see progressStorageKey), so it waits on the id.
  const { data: home } = useQuery({
    queryKey: ['home', 'identity'],
    queryFn: () => trpcClient.home.info.query({}),
    staleTime: Infinity,
  });
  const storageKey = home ? progressStorageKey(home.id) : null;
  useEffect(() => {
    if (!storageKey) return;
    // Read once the home is known: localStorage isn't there during server render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProgress(readProgress(window.localStorage.getItem(storageKey)));
    setHydrated(true);
  }, [storageKey]);

  const newHome = !!userState && !userState.onboardedAt;
  // The default belongs to the home, while progress belongs to this browser.
  // A saved choice survives an unfinished setup opened on another device.
  const needsHarness = newHome && !userState.defaultHarness;
  const harnessPending = needsHarness && progress.replies.harness === undefined;
  const { data: check } = useHarnessCheck(hydrated && harnessPending);

  // History to bring in, looked for from the start (it can take a while).
  // What counts is a recent project still on disk: that's what the import
  // step offers and what the "working on" draft is written from.
  const discovery = useImportDiscovery(hydrated && !!userState);
  const history = discovery.data ? importableHistory(discovery.data) : null;
  const recent = discovery.data ? recentProjects(discovery.data) : [];
  const importFound = discovery.isPending ? null : discovery.isError ? false : recent.length > 0;
  const importRun = useImportRun();

  const ctx: StepContext = {
    needsHarness,
    importFound,
    hasDescription: !!userState?.description?.trim(),
    hasAreas: (areas?.length ?? 0) > 0,
    hasAgents: (workspaces?.length ?? 0) > 0,
    importingAgents: !!importRun && importRun.status !== 'failed',
  };

  // A draft of what they're working on, from that history, once a harness
  // can write it. Usually ready by the time the step comes up.
  const aboutDraft = useAboutDraft(
    { userName: userState?.name?.trim() || null, projects: recent.map((p) => ({ name: p.name, titles: p.titles.slice(0, 4) })) },
    hydrated && !harnessPending && stepApplies('about', ctx) && progress.replies.about === undefined,
  );

  // Area suggestions, once what they're working on is settled.
  const aboutSettled = progress.replies.about !== undefined || (importFound !== null && !stepApplies('about', ctx));
  const projectNames = [...new Set([...(workspaces ?? []).map((w) => w.name), ...(importRun?.projects ?? [])])];
  const areaSuggestions = useAreaSuggestions(
    { about: userState?.description ?? '', projects: projectNames },
    hydrated && !harnessPending && aboutSettled && !ctx.hasAreas,
  );
  // A different browser may already have saved the choice while this one
  // was parked at the harness step. Do not mount its automatic saver with a
  // cached check result, and do not wait on a check that is now disabled.
  const currentStep = progress.step === 'harness' && !needsHarness
    ? nextStep('harness', ctx)
    : progress.step;
  const finished = currentStep === 'done';

  // Reaching the end is finishing: record it once, so the next empty chat
  // opens on the usual intro. This chat keeps the conversation until it's used.
  const recorded = useRef(false);
  useEffect(() => {
    if (!finished || recorded.current || !userState || userState.orchestratorIntroducedAt) return;
    recorded.current = true;
    update.mutate(finishedPatch(userState.onboardedAt));
  }, [finished, update, userState]);

  const advance = (step: OnboardingStep, reply: string) => {
    setProgress((current) => {
      const next: OnboardingProgress = {
        step: nextStep(step, ctx),
        replies: { ...current.replies, [step]: reply },
      };
      try {
        if (storageKey) window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Storage off: the conversation still works, minus resuming.
      }
      return next;
    });
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
      if (storageKey) window.localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
    update.mutate(finishedPatch(userState?.onboardedAt ?? null));
    onSkip();
  };

  if (!hydrated || !userState) return <div className="flex-1" />;

  const steps = stepsThrough(currentStep, progress.replies);
  // Where the harness was picked, a line on what's now the default and a way
  // to change it: after the person's answer when they picked by hand, after
  // the naming when the check picked on its own (that step isn't shown).
  const harnessReply = progress.replies.harness;
  const modelLineAfter: OnboardingStep | null =
    harnessReply === undefined ? null : harnessReply === '' ? 'identity' : 'harness';
  const said: Said = {
    replies: progress.replies,
    userName: userState.name?.trim() || null,
    check,
    history,
    suggestions: areaSuggestions.data?.areas ?? [],
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div ref={columnRef} className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-5 pt-4 pb-8">
        {/* Nothing works without a harness, so skipping waits until there is one. */}
        {!finished && !harnessPending && (
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
          const current = step === currentStep;
          if (current && typing) return <Typing key={`${step}-typing`} />;
          const reply = progress.replies[step];
          return (
            <div key={step} className={cn('flex flex-col gap-3', current && 'animate-in fade-in-0 slide-in-from-bottom-1 duration-300')}>
              <Turn>
                {/* The greeting and the first question are one turn. */}
                {step === 'identity' && <Greeting />}
                {lines(step, said)}
              </Turn>
              {reply !== undefined ? (
                <Reply step={step}>{reply}</Reply>
              ) : step === 'identity' ? (
                <IdentityStep newHome={newHome} onDone={(name) => advance('identity', name)} />
              ) : step === 'harness' ? (
                <HarnessStep check={check} onDone={(r) => advance('harness', r)} />
              ) : step === 'you' ? (
                <YouStep initial={userState.name ?? ''} onDone={(name) => advance('you', name)} />
              ) : step === 'import' ? (
                <ImportStep discovery={discovery.data} loading={discovery.isPending} onDone={(r) => advance('import', r)} />
              ) : step === 'about' ? (
                <AboutStep
                  draft={aboutDraft.data?.about ?? ''}
                  drafting={aboutDraft.isFetching}
                  onDone={(text) => advance('about', text)}
                />
              ) : step === 'areas' ? (
                <AreasStep
                  suggestions={said.suggestions}
                  suggesting={areaSuggestions.isFetching}
                  onDone={(r) => advance('areas', r)}
                />
              ) : step === 'apps' ? (
                <OnboardingApps onDone={(summary) => advance('apps', summary)} />
              ) : step === 'agent' ? (
                <AgentStep onDone={(summary) => advance('agent', summary)} />
              ) : (
                <Starters />
              )}
              {step === modelLineAfter && <DefaultModelLine found={harnessReply === ''} />}
            </div>
          );
        })}
        {/* An import keeps running while the conversation goes on. */}
        <ImportProgress />
        <div ref={endRef} />
      </div>
    </div>
  );
}

/** Finishing the first run: introduced, and (for a new home) set up. */
function finishedPatch(onboardedAt: string | null) {
  const now = new Date().toISOString();
  return { orchestratorIntroducedAt: now, ...(onboardedAt ? {} : { onboardedAt: now }) };
}

/** What's known when the assistant speaks at a step. */
interface Said {
  replies: OnboardingProgress['replies'];
  userName: string | null;
  check: HarnessCheck | undefined;
  history: ImportableHistory | null;
  suggestions: AreaSuggestion[];
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

/** What the assistant says at a step: a word on the last answer, then its question. */
function lines(step: OnboardingStep, said: Said): ReactNode {
  const ack = acknowledge(step, said.replies, said.userName);
  return (
    <>
      {ack && <Says>{ack}</Says>}
      {question(step, said)}
    </>
  );
}

function question(step: OnboardingStep, said: Said): ReactNode {
  switch (step) {
    case 'identity':
      return (
        <Says>
          First, what should I go by? Pick a name and a look, or start from one of these. You can change both any
          time.
        </Says>
      );
    case 'harness':
      return harnessLines(said.check);
    case 'you':
      return <Says>And what should I call you?</Says>;
    case 'import':
      return importQuestion(said.history);
    case 'about':
      return aboutQuestion();
    case 'areas':
      return areasLines(said.suggestions.length > 0);
    case 'apps':
      return (
        <Says>
          Want me to work in the apps you already use? Connect them and I can read and act in them for you. I
          check with you before I send anything or do anything that can’t be undone.
        </Says>
      );
    case 'agent':
      return (
        <Says>
          One more thing. Your agents work in folders on your computer, like a code repo or a folder of
          documents. Add one and I can start work there for you.
        </Says>
      );
    case 'done':
      return <Says>Ask me anything below, or start with one of these.</Says>;
  }
}

/**
 * A word on whatever was answered last, before the next question. Which step
 * that was depends on what this home was asked (a skipped or silent step has
 * no reply), so it's found rather than assumed.
 */
function acknowledge(step: OnboardingStep, replies: OnboardingProgress['replies'], userName: string | null): string | null {
  if (step === 'identity') return null;
  if (step === 'done') return userName ? `You’re all set, ${userName}.` : 'You’re all set.';
  const before = STEP_ORDER.slice(0, STEP_ORDER.indexOf(step)).reverse();
  const last = before.find((s) => !!replies[s]);
  if (!last) return null;
  const reply = replies[last]!;
  switch (last) {
    case 'identity':
      return `${reply} it is.`;
    case 'harness':
      return 'That works. I can think now.';
    case 'you':
      return userName ? `Nice to meet you, ${userName}.` : 'Nice to meet you.';
    case 'import':
      return reply === 'Not now'
        ? 'Okay, they stay where they are.'
        : 'I’m bringing those in now. It takes a few minutes, so let’s keep going.';
    case 'about':
      return reply === ABOUT_SKIPPED ? 'No problem. Tell me any time.' : 'Thanks, that helps.';
    case 'areas':
      return reply === NO_AREAS ? 'Fine, we can add some later.' : 'Done. I’ll file things there.';
    case 'apps':
      return reply === 'Not now' ? 'Sure, connect them any time.' : 'Great.';
    case 'agent':
      return reply === 'Later' ? 'No rush.' : 'Nice.';
    default:
      return null;
  }
}



// ─── Steps ────────────────────────────────────────────────────

function IdentityStep({ newHome, onDone }: { newHome: boolean; onDone: (name: string) => void }) {
  const { data: userState } = useUserState();
  const [draft, setDraft] = useState<IdentityDraft>(() => draftFromState(userState));
  const { save, saving } = useSaveIdentity();
  const submit = async () => {
    if (await save(draft)) onDone(draftName(draft));
  };
  return (
    <Card>
      <IdentityEditor draft={draft} onChange={setDraft} onSubmit={() => void submit()} />
      <div className="mt-3 flex items-end justify-between gap-3">
        {/* The one thing to know before anything is set up here. */}
        {newHome ? (
          <p className="text-[10.5px] leading-snug text-muted-foreground">
            Already use {APP_NAME} on another computer? Stop this one and run{' '}
            <code className="font-mono text-foreground/80">{APP_SHORT_ID} connect</code> to use that one here. A
            new home with nothing in it is set aside, not deleted.
          </p>
        ) : (
          <span />
        )}
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
