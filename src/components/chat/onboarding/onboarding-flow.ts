/**
 * The main chat's first-run conversation, as data: the order steps are asked
 * in, which apply to this home, which are over, and which this conversation
 * shows. What was answered is kept on the home (`user_state.onboarding`,
 * src/lib/onboarding/progress.ts), so a reload, an integration's sign-in
 * redirect or another window picks up where it was. The rendering is
 * `main-chat-onboarding.tsx`. Full flow: docs/main-chat-onboarding.md.
 */

import { ONBOARDING_STEPS, type OnboardingRecord, type OnboardingStepName } from '@/lib/onboarding/progress';

/** A step of the conversation, or its end. Steps are stored by name (src/lib/onboarding/progress.ts). */
export type OnboardingStep = OnboardingStepName | 'done';

export const STEP_ORDER: readonly OnboardingStep[] = [
  'identity',
  'harness',
  'you',
  'import',
  'about',
  'areas',
  'apps',
  'agent',
  'done',
];

/** The steps in the order they're asked, without the end. */
const ONBOARDING_STEPS_IN_ORDER = STEP_ORDER.filter((s): s is OnboardingStepName => s !== 'done');

/** What decides whether a step is worth asking in this home. */
export interface StepContext {
  /** Never set up: the harness hasn't been checked and saved. */
  needsHarness: boolean;
  /** History from Claude Code, Codex or OpenCode to bring in. Null while still looking. */
  importFound: boolean | null;
  /** Already says what they're working on (user_state.description). */
  hasDescription: boolean;
  hasAreas: boolean;
  hasAgents: boolean;
  /** An import is bringing projects in as agents (it runs in the background). */
  importingAgents?: boolean;
}

/**
 * Steps ask only what this home doesn't already have. The harness for a home
 * that was set up, import when there's nothing to bring in, areas for someone
 * who has some, a first agent for someone who has one: each is skipped. Import
 * still shows while the search is running, and the step waits on it.
 *
 * "What are you working on" is never a blank box: it's a draft written from
 * the history the import step found, to confirm or fix. With no history to
 * draft from, or a description already there, it isn't asked.
 */
export function stepApplies(step: OnboardingStep, ctx: StepContext): boolean {
  switch (step) {
    case 'harness':
      return ctx.needsHarness;
    case 'import':
      return ctx.importFound !== false;
    case 'about':
      return !ctx.hasDescription && ctx.importFound !== false;
    case 'areas':
      return !ctx.hasAreas;
    case 'agent':
      return !ctx.hasAgents && !ctx.importingAgents;
    default:
      return true;
  }
}

/**
 * Steps whose answer is already on file, so a home that answered them before
 * steps were recorded (named its assistant, gave its own name) isn't asked
 * again. The rest are covered by `stepApplies`: a description, areas or
 * agents on file mean those steps don't apply.
 */
export function stepsOnFile(state: {
  name?: string | null;
  orchestratorName?: string | null;
  orchestratorEmoji?: string | null;
  orchestratorImage?: unknown;
}): Set<OnboardingStepName> {
  const steps = new Set<OnboardingStepName>();
  if (state.orchestratorName || state.orchestratorEmoji || state.orchestratorImage) steps.add('identity');
  if (state.name?.trim()) steps.add('you');
  return steps;
}

/** Steps that are over: finished in the conversation, any way, or on file. */
export function doneSteps(record: OnboardingRecord, onFile: ReadonlySet<OnboardingStepName>): Set<OnboardingStepName> {
  const done = new Set(onFile);
  for (const step of ONBOARDING_STEPS) if (record.steps[step]) done.add(step);
  return done;
}

/** The next step after `step` (from the start when null) that applies and isn't done. */
export function nextStep(
  step: OnboardingStep | null,
  ctx: StepContext,
  done: ReadonlySet<OnboardingStepName> = new Set(),
): OnboardingStep {
  for (let i = step === null ? 0 : STEP_ORDER.indexOf(step) + 1; i < STEP_ORDER.length; i += 1) {
    const candidate = STEP_ORDER[i]!;
    if (candidate === 'done') return 'done';
    if (!done.has(candidate) && stepApplies(candidate, ctx)) return candidate;
  }
  return 'done';
}

/** The steps still to ask this home, in order. */
export function openSteps(ctx: StepContext, done: ReadonlySet<OnboardingStepName>): OnboardingStepName[] {
  return ONBOARDING_STEPS_IN_ORDER.filter((step) => !done.has(step) && stepApplies(step, ctx));
}

/**
 * The steps this conversation shows as already said, in order: the ones
 * answered in one of its chats. Steps finished in an earlier chat aren't
 * replayed, and a skipped one was never said.
 */
export function stepsInConversation(record: OnboardingRecord, chatIds: ReadonlySet<string>): OnboardingStepName[] {
  return ONBOARDING_STEPS_IN_ORDER.filter((step) => {
    const entry = record.steps[step];
    return entry?.status === 'answered' && !!entry.chatId && chatIds.has(entry.chatId);
  });
}

/** What the person said at each step of this conversation. */
export function repliesInConversation(
  record: OnboardingRecord,
  chatIds: ReadonlySet<string>,
): Partial<Record<OnboardingStepName, string>> {
  const replies: Partial<Record<OnboardingStepName, string>> = {};
  for (const step of stepsInConversation(record, chatIds)) replies[step] = record.steps[step]?.reply ?? '';
  return replies;
}

/**
 * What a step goes by when it's offered on its own, as one quiet line under
 * an empty chat's usual starters: a step added after this home finished.
 */
export const STEP_TITLES: Record<OnboardingStepName, string> = {
  identity: 'Give your assistant a name and a look',
  harness: 'Choose the coding tool I think with',
  you: 'Tell me what to call you',
  import: 'Bring in your chats from other coding tools',
  about: 'Tell me what you’re working on',
  areas: 'Group your work into areas',
  apps: 'Connect the apps you use',
  agent: 'Add your first agent',
};

/** "Google", "Google and Slack", "Google, Slack and Notion". */
export function listJoin(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
