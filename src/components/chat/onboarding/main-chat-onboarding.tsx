'use client';

import { MainChatIntroPanel, appMainChatIntro, useEmptyChatActions } from '@/components/chat/main-chat-intro';
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
import { mainChatKey, useMainChat } from '@/hooks/use-main-chat';
import { useOrchestratorName, useUpdateUserState, useUserState } from '@/hooks/use-user-state';
import { useWorkspaces } from '@/hooks/use-workspaces';
import { apiErrorText } from '@/lib/api/client';
import type { AreaSuggestion } from '@/lib/onboarding/area-suggestions';
import { baseOnboardingRecord, type OnboardingRecord, type OnboardingStepName } from '@/lib/onboarding/progress';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowUp, FolderPlus, ListChecks, PenLine } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useImportRun } from './import-runner';
import { ABOUT_SKIPPED, AboutStep, aboutQuestion, useAboutDraft } from './onboarding-about';
import { OnboardingApps } from './onboarding-apps';
import { AreasStep, NO_AREAS, areasLines, useAreaSuggestions } from './onboarding-areas';
import { DefaultModelLine } from './onboarding-default-model';
import {
	STEP_ORDER,
	STEP_TITLES,
	doneSteps,
	nextStep,
	openSteps,
	repliesInConversation,
	stepApplies,
	stepsInConversation,
	stepsOnFile,
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
import { useOnboardingProgress } from './use-onboarding-progress';
import { Tip } from '@/components/ui/tip';

/** How long the assistant "types" before a new step appears. */
const TYPING_MS = 650;

/**
 * What an empty main chat shows: the first-run conversation for a home that
 * hasn't finished it, the usual intro with one quiet line for a step added
 * after it finished, or just the usual intro.
 */
type Mode = 'conversation' | 'new-step' | 'intro';

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
 * Progress is kept on the home, step by step (`user_state.onboarding`), so a
 * reload, a sign-in redirect or another window picks up where it was. Writing
 * in the chat instead of answering skips the question on screen (the server
 * does it as the message arrives), and the rest come back on the next new
 * chat, after a short line rather than the welcome. Finishing or "Skip setup"
 * fills in the rest and records `orchestratorIntroducedAt`. After that the
 * chat opens on the usual intro, and a step added since is offered there as
 * one line, once.
 */
export function MainChatOnboarding() {
  const userStateQuery = useUserState();
  const userState = userStateQuery.data;
  const { data: workspaces } = useWorkspaces({ status: 'active' });
  const { data: areas } = useAreas();
  const { data: mainChat } = useMainChat(null);
  const chatId = mainChat?.session.id ?? null;
  const name = useOrchestratorName();
  const actions = useEmptyChatActions();
  const progress = useOnboardingProgress();
  const qc = useQueryClient();
  const [typing, setTyping] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const record = userState ? baseOnboardingRecord(userState.onboarding, userState.orchestratorIntroducedAt) : EMPTY_RECORD;

  // The chats this conversation has been in: the one it opened in, and one
  // that replaced it while it was up (the harness step starts the empty chat
  // over). Their answers are this conversation's.
  const [chats, setChats] = useState<ReadonlySet<string>>(() => new Set());
  if (chatId && !chats.has(chatId)) setChats(new Set([...chats, chatId]));

  // Decided once per empty chat, from fresh user state (a message sent
  // elsewhere may have skipped a step since it was cached) and the areas and
  // agents that decide which steps apply. Answers on file are read then, so
  // one given in this conversation doesn't count twice.
  const [decided, setDecided] = useState<{ mode: Mode; onFile: ReadonlySet<OnboardingStepName>; fresh: boolean } | null>(null);
  const onFile = decided?.onFile ?? EMPTY_STEPS;
  const done = doneSteps(record, onFile);

  const newHome = !!userState && !userState.onboardedAt;
  // The default belongs to the home: a choice saved on another device counts.
  const needsHarness = newHome && !userState.defaultHarness;
  const harnessPending = needsHarness && !done.has('harness');
  const conversing = decided?.mode === 'conversation';
  const { data: check } = useHarnessCheck(conversing && harnessPending);

  // History to bring in, looked for from the start (it can take a while).
  // What counts is a recent project still on disk: that's what the import
  // step offers and what the "working on" draft is written from.
  const wantsHistory = !!decided && decided.mode !== 'intro' && (!done.has('import') || !done.has('about'));
  const discovery = useImportDiscovery(wantsHistory);
  const history = discovery.data ? importableHistory(discovery.data) : null;
  const recent = discovery.data ? recentProjects(discovery.data) : [];
  const importFound = !wantsHistory ? false : discovery.isPending ? null : discovery.isError ? false : recent.length > 0;
  const importRun = useImportRun();

  const ctx: StepContext = {
    needsHarness,
    importFound,
    hasDescription: !!userState?.description?.trim(),
    hasAreas: (areas?.length ?? 0) > 0,
    hasAgents: (workspaces?.length ?? 0) > 0,
    importingAgents: !!importRun && importRun.status !== 'failed',
  };

  // Fresh as this chat opens: cached user state can be up to a refetch old,
  // and a message sent since may have skipped a step.
  const [fetchedNow, setFetchedNow] = useState(false);
  const refetchUserState = userStateQuery.refetch;
  useEffect(() => {
    let open = true;
    void refetchUserState().finally(() => {
      if (open) setFetchedNow(true);
    });
    return () => {
      open = false;
    };
  }, [refetchUserState]);

  const ready = !!userState && fetchedNow && areas !== undefined && workspaces !== undefined && !!chatId;
  if (ready && !decided) {
    const said = new Set(stepsInConversation(record, chats));
    // On file but said in this conversation (a name just picked) isn't an earlier answer.
    const snapshot = new Set([...stepsOnFile(userState)].filter((step) => !said.has(step)));
    const done = doneSteps(record, snapshot);
    const open = openSteps({ ...ctx, importFound: null }, done);
    const mode: Mode = !userState.orchestratorIntroducedAt
      ? open.length > 0 ? 'conversation' : 'intro'
      : open.length > 0 ? 'new-step' : 'intro';
    // The welcome, unless something was settled before this conversation: then a line on picking up.
    const fresh = [...done].every((step) => said.has(step));
    setDecided({ mode, onFile: snapshot, fresh });
  }

  // A home with nothing left to ask that never finished: it's finished now.
  const finishedQuietly = useRef(false);
  useEffect(() => {
    if (decided?.mode !== 'intro' || !userState || userState.orchestratorIntroducedAt || finishedQuietly.current) return;
    finishedQuietly.current = true;
    void progress.finish({ skipped: false, ...(chatId ? { chatId } : {}) });
  }, [decided, userState, progress, chatId]);

  // A draft of what they're working on, from that history, once a harness
  // can write it. Usually ready by the time the step comes up.
  const aboutDraft = useAboutDraft(
    { userName: userState?.name?.trim() || null, projects: recent.map((p) => ({ name: p.name, titles: p.titles.slice(0, 4) })) },
    wantsHistory && !harnessPending && stepApplies('about', ctx) && !done.has('about'),
  );

  // Area suggestions, once what they're working on is settled.
  const aboutSettled = done.has('about') || (importFound !== null && !stepApplies('about', ctx));
  const projectNames = [...new Set([...(workspaces ?? []).map((w) => w.name), ...(importRun?.projects ?? [])])];
  const areaSuggestions = useAreaSuggestions(
    { about: userState?.description ?? '', projects: projectNames },
    !!decided && decided.mode !== 'intro' && !harnessPending && aboutSettled && !ctx.hasAreas && !done.has('areas'),
  );

  // The step being asked. It moves on when answered here, and when it's
  // over some other way: answered in another window, or (the harness) set
  // up there.
  const [asking, setAsking] = useState<OnboardingStep | null>(null);
  if (conversing && asking === null) setAsking(nextStep(null, ctx, done));
  // Saving here sets the default before it replaces the empty chat, so that
  // isn't "set up in another window" until it's finished.
  const [savingHarness, setSavingHarness] = useState(false);
  const over = (step: OnboardingStep) =>
    step !== 'done' && (done.has(step) || (step === 'harness' && !needsHarness && !savingHarness));
  const currentStep: OnboardingStep | null = asking && over(asking) ? nextStep(asking, ctx, done) : asking;
  const finished = currentStep === 'done';

  // Reaching the end is finishing: record it once, so the next empty chat
  // opens on the usual intro. This chat keeps the conversation until it's used.
  const recorded = useRef(false);
  useEffect(() => {
    if (!finished || recorded.current || !userState || userState.orchestratorIntroducedAt) return;
    recorded.current = true;
    void progress.finish({ skipped: false, ...(chatId ? { chatId } : {}) });
  }, [finished, userState, progress, chatId]);

  // A step added since this home finished, offered under the usual intro.
  const newStep = decided?.mode === 'new-step' ? openSteps(ctx, done)[0] ?? null : null;

  // Tell the home which question is on screen, so writing in the chat
  // instead skips it. Never the harness: a new home can't do without one.
  const onScreen: OnboardingStepName | null = conversing
    ? currentStep && currentStep !== 'done' && currentStep !== 'harness' && !typing ? currentStep : null
    : newStep;
  const shownStep = record.current?.step ?? null;
  const shownChat = record.current?.chatId ?? null;
  useEffect(() => {
    if (!onScreen || !chatId) return;
    if (shownStep === onScreen && shownChat === chatId) return;
    progress.show(onScreen, chatId);
  }, [onScreen, chatId, shownStep, shownChat, progress]);

  const advance = (step: OnboardingStepName, reply: string) => {
    // The main chat as it is now: the harness step may have just replaced it,
    // after this was rendered, and its answer belongs to the new one.
    const liveChat = qc.getQueryData<{ session: { id: string } }>(mainChatKey(null))?.session.id ?? chatId;
    if (liveChat) progress.record(step, { status: 'answered', reply, chatId: liveChat });
    const after = new Set(done).add(step);
    setAsking(nextStep(step, ctx, after));
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
  }, [conversing]);

  const skip = () => {
    void progress.finish({ skipped: true, ...(chatId ? { chatId } : {}) });
    setDecided((d) => (d ? { ...d, mode: 'intro' } : d));
  };

  const said: Said = {
    replies: repliesInConversation(record, chats),
    userName: userState?.name?.trim() || null,
    check,
    history,
    suggestions: areaSuggestions.data?.areas ?? [],
  };

  /** A step's own card, the same in the conversation and when offered on its own. */
  const stepCard = (step: OnboardingStepName, onDone: (reply: string) => void): ReactNode => {
    switch (step) {
      case 'identity':
        return <IdentityStep newHome={newHome} onDone={onDone} />;
      case 'harness':
        return <HarnessStep check={check} onDone={onDone} onBusy={setSavingHarness} />;
      case 'you':
        return <YouStep initial={userState?.name ?? ''} onDone={onDone} />;
      case 'import':
        return <ImportStep discovery={discovery.data} loading={discovery.isPending} onDone={onDone} />;
      case 'about':
        return <AboutStep draft={aboutDraft.data?.about ?? ''} drafting={aboutDraft.isFetching} onDone={onDone} />;
      case 'areas':
        return <AreasStep suggestions={said.suggestions} suggesting={areaSuggestions.isFetching} onDone={onDone} />;
      case 'apps':
        return <OnboardingApps onDone={onDone} />;
      case 'agent':
        return <AgentStep onDone={onDone} />;
    }
  };

  const intro = (footer?: ReactNode) => (
    <MainChatIntroPanel
      intro={appMainChatIntro(name)}
      onSend={actions.send}
      onDraft={actions.draft}
      disabled={actions.disabled}
      footer={footer}
    />
  );

  if (!decided) {
    // A home that finished almost always opens on the usual intro, so show it
    // while checking. One that hasn't waits for its conversation.
    return userState?.orchestratorIntroducedAt ? intro() : <div className="flex-1" />;
  }
  if (decided.mode === 'intro') return intro();
  if (decided.mode === 'new-step') {
    return intro(
      newStep && chatId ? (
        <NewStepOffer
          key={newStep}
          step={newStep}
          onDecline={() => progress.record(newStep, { status: 'skipped', chatId })}
        >
          {stepCard(newStep, (reply) => progress.record(newStep, { status: 'answered', reply, chatId }))}
        </NewStepOffer>
      ) : undefined,
    );
  }

  // What this conversation shows: what was said in it, then the question.
  const saidSteps = stepsInConversation(record, chats);
  const steps = STEP_ORDER.filter((s) => s === currentStep || (s !== 'done' && saidSteps.includes(s)));
  // The harness set up on its own shows as its model line, where it happened.
  const firstTurn = steps.find((s) => !(s === 'harness' && said.replies.harness === ''));

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
          const reply = step === 'done' ? undefined : said.replies[step];
          if (step === 'harness' && reply === '') {
            return <DefaultModelLine key={step} found />;
          }
          return (
            <div key={step} className={cn('flex flex-col gap-3', current && 'animate-in fade-in-0 slide-in-from-bottom-1 duration-300')}>
              <Turn>
                {/* The opening and the first question are one turn. */}
                {step === firstTurn && (decided.fresh ? <Greeting /> : <Resuming />)}
                {lines(step, said)}
              </Turn>
              {reply !== undefined ? (
                <Reply step={step}>{reply}</Reply>
              ) : step === 'done' ? (
                <Starters />
              ) : (
                stepCard(step, (r) => advance(step, r))
              )}
              {step === 'harness' && reply !== undefined && <DefaultModelLine found={false} />}
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

const EMPTY_RECORD: OnboardingRecord = { steps: {} };
const EMPTY_STEPS: ReadonlySet<OnboardingStepName> = new Set();

/** What's known when the assistant speaks at a step. */
interface Said {
  replies: Partial<Record<OnboardingStepName, string>>;
  userName: string | null;
  check: HarnessCheck | undefined;
  history: ImportableHistory | null;
  suggestions: AreaSuggestion[];
}

/**
 * A step added after this home finished setting up, as one line under the
 * usual starters: what it is, Set up to open its card here, Not now to let
 * it go for good. Writing in the chat instead lets it go too.
 */
function NewStepOffer({ step, onDecline, children }: { step: OnboardingStepName; onDecline: () => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-5 border-t border-border/60 pt-3">
      <div className="flex items-center gap-2 text-[11.5px]">
        <ListChecks size={12} className="flex-shrink-0 text-muted-foreground" />
        <span className="flex-shrink-0 text-muted-foreground">New</span>
        <span className="min-w-0 flex-1 truncate text-foreground/85">{STEP_TITLES[step]}</span>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex-shrink-0 rounded px-1.5 py-0.5 font-medium text-foreground underline-offset-2 hover:underline"
          >
            Set up
          </button>
        )}
        <button
          type="button"
          onClick={onDecline}
          className="flex-shrink-0 rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          Not now
        </button>
      </div>
      {open && <div className="mt-2">{children}</div>}
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

/** The opening when this home already answered some of it, in an earlier chat or before. */
function Resuming() {
  return <Says>A few things are left from setting up. Answer any of them, or skip.</Says>;
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
function acknowledge(step: OnboardingStep, replies: Said['replies'], userName: string | null): string | null {
  if (step === 'identity') return null;
  if (step === 'done') return userName ? `You’re all set, ${userName}.` : 'You’re all set.';
  const before = STEP_ORDER.slice(0, STEP_ORDER.indexOf(step)).reverse().filter((s): s is OnboardingStepName => s !== 'done');
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
        <Tip key={s.label} label={s.draft ? 'Start this in the composer' : 'Send this'}>
          <button
            type="button"
            disabled={actions.disabled}
            onClick={() => (s.draft ? actions.draft(s.prompt) : actions.send(s.prompt))}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12px] text-foreground/90 transition-colors hover:bg-muted/60 disabled:opacity-50"
          >
            {s.draft ? <PenLine size={11} className="text-muted-foreground" /> : <ArrowUp size={11} className="text-muted-foreground" />}
            {s.label}
          </button>
        </Tip>
      ))}
    </div>
  );
}
