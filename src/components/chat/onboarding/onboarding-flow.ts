/**
 * The main chat's first-run conversation, as data: which steps there are, in
 * what order, which apply to this home, what the user answered, and how that
 * survives a reload or an OAuth round trip (the browser leaves the app to
 * sign in to a connector). The rendering is `main-chat-onboarding.tsx`. Full
 * flow: docs/main-chat-onboarding.md.
 */

export type OnboardingStep =
  | 'identity'
  | 'harness'
  | 'you'
  | 'about'
  | 'import'
  | 'areas'
  | 'apps'
  | 'agent'
  | 'done';

export const STEP_ORDER: readonly OnboardingStep[] = [
  'identity',
  'harness',
  'you',
  'about',
  'import',
  'areas',
  'apps',
  'agent',
  'done',
];

/** What decides whether a step is worth asking in this home. */
export interface StepContext {
  /** Never set up: the harness hasn't been checked and saved. */
  needsHarness: boolean;
  /** History from Claude Code, Codex or OpenCode to bring in. Null while still looking. */
  importFound: boolean | null;
  hasAreas: boolean;
  hasAgents: boolean;
}

/**
 * Steps ask only what this home doesn't already have. The harness for a home
 * that was set up, import when there's nothing to bring in, areas for someone
 * who has some, a first agent for someone who has one: each is skipped. Import
 * still shows while the search is running, and the step waits on it.
 */
export function stepApplies(step: OnboardingStep, ctx: StepContext): boolean {
  switch (step) {
    case 'harness':
      return ctx.needsHarness;
    case 'import':
      return ctx.importFound !== false;
    case 'areas':
      return !ctx.hasAreas;
    case 'agent':
      return !ctx.hasAgents;
    default:
      return true;
  }
}

export interface OnboardingProgress {
  step: OnboardingStep;
  /**
   * What the user said at each finished step, shown as their reply. An empty
   * reply is a step finished without a word (the harness set up on its own),
   * which the conversation doesn't show.
   */
  replies: Partial<Record<OnboardingStep, string>>;
}

export const FIRST_PROGRESS: OnboardingProgress = { step: 'identity', replies: {} };

/** Per browser, so a reload or a sign-in redirect picks up where it was. */
export const PROGRESS_STORAGE_KEY = 'ri.mainChat.onboarding';

/** The next step after `step` that applies to this home. */
export function nextStep(step: OnboardingStep, ctx: StepContext): OnboardingStep {
  for (let i = STEP_ORDER.indexOf(step) + 1; i < STEP_ORDER.length; i += 1) {
    const candidate = STEP_ORDER[i]!;
    if (stepApplies(candidate, ctx)) return candidate;
  }
  return 'done';
}

/** The steps shown so far, finished ones and the current one, in order. */
export function stepsThrough(step: OnboardingStep, replies: OnboardingProgress['replies']): OnboardingStep[] {
  const upTo = STEP_ORDER.slice(0, STEP_ORDER.indexOf(step) + 1);
  // A skipped step has no reply, and a silent one an empty reply: neither is
  // part of the conversation unless it's the current step.
  return upTo.filter((s) => s === step || !!replies[s]);
}

/** Saved progress, or the start when there's none or it doesn't parse. */
export function readProgress(raw: string | null): OnboardingProgress {
  if (!raw) return FIRST_PROGRESS;
  try {
    const parsed = JSON.parse(raw) as Partial<OnboardingProgress>;
    if (!parsed || !STEP_ORDER.includes(parsed.step as OnboardingStep)) return FIRST_PROGRESS;
    const replies: OnboardingProgress['replies'] = {};
    for (const s of STEP_ORDER) {
      const reply = parsed.replies?.[s];
      if (typeof reply === 'string') replies[s] = reply;
    }
    return { step: parsed.step as OnboardingStep, replies };
  } catch {
    return FIRST_PROGRESS;
  }
}

/** "Google", "Google and Slack", "Google, Slack and Notion". */
export function listJoin(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
