/**
 * Where a home is in the main chat's first-run conversation
 * (docs/main-chat-onboarding.md), kept on the home (`user_state.onboarding`)
 * so every window onto it, the desktop app, a browser, a phone, agrees.
 *
 * Steps are keyed by name, never by position: the order lives in the
 * conversation's code (`STEP_ORDER`), so steps can be reordered freely. A
 * step's name is what it asks. Reword a question and it keeps its name.
 * Change what it asks and it gets a new name, so old answers don't count for
 * it. A removed step's records are ignored on read.
 *
 * Pure, so the server (which writes it) and the client (which reads it) share
 * one set of rules, and the rules are tested apart from both.
 */

/** Every step the conversation can ask, by name. */
export const ONBOARDING_STEPS = ['identity', 'harness', 'you', 'import', 'about', 'areas', 'apps', 'agent'] as const;
export type OnboardingStepName = (typeof ONBOARDING_STEPS)[number];

/**
 * The steps a home that finished before steps were recorded went through:
 * all of them, as of 2026-10-06. A step added after that isn't here, so such
 * a home is offered just that step, quietly. Never add to this list.
 */
export const STEPS_BEFORE_RECORDS: readonly OnboardingStepName[] = [
  'identity',
  'harness',
  'you',
  'import',
  'about',
  'areas',
  'apps',
  'agent',
];

/**
 * How a step ended. `answered`: the person responded in it, "Not now"
 * buttons included (the reply says which). `skipped`: passed over, by sending
 * a message while it was on screen or by "Skip setup". `not_asked`: it didn't
 * apply when the home finished, so it was never put to them.
 */
export type OnboardingStepStatus = 'answered' | 'skipped' | 'not_asked';

export interface OnboardingStepRecord {
  status: OnboardingStepStatus;
  /** What they said, shown as their reply in the chat it was answered in. */
  reply?: string;
  /** The chat it was finished in. None for steps filled in when the home finished. */
  chatId?: string;
  at: string;
}

export interface OnboardingRecord {
  /** The question on screen and the chat it's in. A person's message in that chat skips it. */
  current?: { step: OnboardingStepName; chatId: string };
  steps: Partial<Record<OnboardingStepName, OnboardingStepRecord>>;
}

/** Longest reply kept: the bubble it's shown in, not a document. */
export const ONBOARDING_REPLY_MAX = 1000;

const STATUSES: readonly OnboardingStepStatus[] = ['answered', 'skipped', 'not_asked'];

export function isOnboardingStep(value: unknown): value is OnboardingStepName {
  return typeof value === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(value);
}

/**
 * A stored record, keeping only what this version understands: steps it
 * knows, entries that parse. Anything else (a removed step, a damaged entry)
 * is dropped rather than failing the read.
 */
export function readOnboardingRecord(value: unknown): OnboardingRecord {
  const record: OnboardingRecord = { steps: {} };
  if (!value || typeof value !== 'object') return record;
  const raw = value as { current?: unknown; steps?: unknown };
  if (raw.steps && typeof raw.steps === 'object') {
    for (const [step, entry] of Object.entries(raw.steps as Record<string, unknown>)) {
      if (!isOnboardingStep(step) || !entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      if (!STATUSES.includes(e.status as OnboardingStepStatus) || typeof e.at !== 'string') continue;
      record.steps[step] = {
        status: e.status as OnboardingStepStatus,
        at: e.at,
        ...(typeof e.reply === 'string' ? { reply: e.reply } : {}),
        ...(typeof e.chatId === 'string' ? { chatId: e.chatId } : {}),
      };
    }
  }
  const current = raw.current as { step?: unknown; chatId?: unknown } | undefined;
  if (current && isOnboardingStep(current.step) && typeof current.chatId === 'string' && !record.steps[current.step]) {
    record.current = { step: current.step, chatId: current.chatId };
  }
  return record;
}

/**
 * The record every rule starts from. A home that finished before steps were
 * recorded has none, and counts as having been through every step there was
 * then (`STEPS_BEFORE_RECORDS`), so only a step added since is new to it.
 */
export function baseOnboardingRecord(stored: unknown, introducedAt: string | null | undefined): OnboardingRecord {
  const record = readOnboardingRecord(stored);
  if (stored || !introducedAt) return record;
  for (const step of STEPS_BEFORE_RECORDS) record.steps[step] = { status: 'not_asked', at: introducedAt };
  return record;
}

/** A step finished: recorded, and no longer the one on screen. */
export function withStepRecorded(
  record: OnboardingRecord,
  step: OnboardingStepName,
  entry: OnboardingStepRecord,
): OnboardingRecord {
  const steps = { ...record.steps, [step]: entry };
  const current = record.current && record.current.step !== step ? record.current : undefined;
  return { ...(current ? { current } : {}), steps };
}

/** The question now on screen, in this chat. A step already finished never is. */
export function withStepShown(record: OnboardingRecord, step: OnboardingStepName, chatId: string): OnboardingRecord {
  if (record.steps[step]) return record;
  return { ...record, current: { step, chatId } };
}

/**
 * A person sent a message in a chat. If that's where a question is on screen,
 * they passed it over: it's skipped, and the rest come back on their next new
 * chat. Null when nothing changes: no question on screen, another chat, or the
 * harness step, which a new home can't do without.
 */
export function withMessageSent(record: OnboardingRecord, chatId: string, at: string): OnboardingRecord | null {
  const current = record.current;
  if (!current || current.chatId !== chatId || current.step === 'harness') return null;
  return withStepRecorded(record, current.step, { status: 'skipped', chatId, at });
}

/**
 * The conversation is over: every step not yet finished is filled in, as
 * skipped ("Skip setup") or as not asked (it didn't apply). So a step added
 * later is the only kind a finished home has no record of.
 */
export function withFinished(record: OnboardingRecord, input: { skipped: boolean; chatId?: string; at: string }): OnboardingRecord {
  const steps = { ...record.steps };
  for (const step of ONBOARDING_STEPS) {
    if (steps[step]) continue;
    steps[step] = {
      status: input.skipped ? 'skipped' : 'not_asked',
      at: input.at,
      ...(input.chatId ? { chatId: input.chatId } : {}),
    };
  }
  return { steps };
}

/**
 * The empty chat the conversation is in was replaced by a fresh one (the
 * harness or model changed, and a chat's are fixed when it's made). The
 * conversation goes with it, so its answers still show there.
 */
export function withChatMoved(record: OnboardingRecord, from: string, to: string): OnboardingRecord {
  const steps: OnboardingRecord['steps'] = {};
  for (const step of ONBOARDING_STEPS) {
    const entry = record.steps[step];
    if (entry) steps[step] = entry.chatId === from ? { ...entry, chatId: to } : entry;
  }
  const current = record.current?.chatId === from ? { ...record.current, chatId: to } : record.current;
  return { ...(current ? { current } : {}), steps };
}

/** Clamp a reply to what's kept. */
export function clampReply(reply: string): string {
  return reply.length > ONBOARDING_REPLY_MAX ? `${reply.slice(0, ONBOARDING_REPLY_MAX - 1)}…` : reply;
}
