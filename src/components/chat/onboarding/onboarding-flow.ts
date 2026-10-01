/**
 * The main chat's first-run conversation, as data: which steps there are, in
 * what order, what the user answered, and how that survives a reload or an
 * OAuth round trip (the browser leaves the app to sign in to a connector).
 * The rendering is `main-chat-onboarding.tsx`. Full flow:
 * docs/main-chat-onboarding.md.
 */

export type OnboardingStep = 'identity' | 'you' | 'about' | 'apps' | 'agent' | 'done';

export const STEP_ORDER: readonly OnboardingStep[] = ['identity', 'you', 'about', 'apps', 'agent', 'done'];

export interface OnboardingProgress {
  step: OnboardingStep;
  /** What the user said at each finished step, shown as their reply. */
  replies: Partial<Record<OnboardingStep, string>>;
}

export const FIRST_PROGRESS: OnboardingProgress = { step: 'identity', replies: {} };

/** Per browser, so a reload or a sign-in redirect picks up where it was. */
export const PROGRESS_STORAGE_KEY = 'ri.mainChat.onboarding';

/**
 * The step after `step`. Adding an agent is offered only to someone with
 * none: anyone who already has one knows where work happens.
 */
export function nextStep(step: OnboardingStep, ctx: { hasAgents: boolean }): OnboardingStep {
  let i = STEP_ORDER.indexOf(step) + 1;
  while (STEP_ORDER[i] === 'agent' && ctx.hasAgents) i += 1;
  return STEP_ORDER[Math.min(i, STEP_ORDER.length - 1)]!;
}

/** The steps shown so far, finished ones and the current one, in order. */
export function stepsThrough(step: OnboardingStep, replies: OnboardingProgress['replies']): OnboardingStep[] {
  const upTo = STEP_ORDER.slice(0, STEP_ORDER.indexOf(step) + 1);
  // A skipped step (the agent one, for someone who has agents) has no reply
  // and isn't the current step, so it isn't part of the conversation.
  return upTo.filter((s) => s === step || replies[s] !== undefined);
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
