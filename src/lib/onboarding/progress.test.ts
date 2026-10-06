import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_REPLY_MAX,
  ONBOARDING_STEPS,
  STEPS_BEFORE_RECORDS,
  baseOnboardingRecord,
  clampReply,
  readOnboardingRecord,
  withChatMoved,
  withFinished,
  withMessageSent,
  withStepRecorded,
  withStepShown,
  type OnboardingRecord,
} from './progress';

const AT = '2026-10-06T12:00:00.000Z';

describe('readOnboardingRecord', () => {
  it('keeps the steps it knows and drops what it does not', () => {
    const record = readOnboardingRecord({
      current: { step: 'apps', chatId: 'c1' },
      steps: {
        identity: { status: 'answered', reply: 'Rye', chatId: 'c1', at: AT },
        // A step removed since, and a damaged entry.
        retired: { status: 'answered', at: AT },
        you: { status: 'pondered', at: AT },
      },
    });
    expect(record).toEqual({
      current: { step: 'apps', chatId: 'c1' },
      steps: { identity: { status: 'answered', reply: 'Rye', chatId: 'c1', at: AT } },
    });
  });

  it('reads nothing as a fresh record, and never keeps a finished step on screen', () => {
    expect(readOnboardingRecord(null)).toEqual({ steps: {} });
    expect(readOnboardingRecord('not an object')).toEqual({ steps: {} });
    expect(
      readOnboardingRecord({ current: { step: 'you', chatId: 'c1' }, steps: { you: { status: 'answered', at: AT } } }),
    ).toEqual({ steps: { you: { status: 'answered', at: AT } } });
  });
});

describe('baseOnboardingRecord', () => {
  it('counts a home that finished before records as having seen every step there was', () => {
    const base = baseOnboardingRecord(null, AT);
    expect(Object.keys(base.steps).sort()).toEqual([...STEPS_BEFORE_RECORDS].sort());
    expect(base.steps.apps).toEqual({ status: 'not_asked', at: AT });
  });

  it('starts an unfinished home empty, and reads a stored record as it is', () => {
    expect(baseOnboardingRecord(null, null)).toEqual({ steps: {} });
    const stored = { steps: { identity: { status: 'answered', at: AT } } };
    expect(baseOnboardingRecord(stored, AT)).toEqual(stored);
  });
});

describe('a step on screen', () => {
  const shown = withStepShown({ steps: {} }, 'you', 'c1');

  it('is recorded as on screen in its chat, unless it already finished', () => {
    expect(shown.current).toEqual({ step: 'you', chatId: 'c1' });
    const done = withStepRecorded(shown, 'you', { status: 'answered', reply: 'Trey', chatId: 'c1', at: AT });
    expect(withStepShown(done, 'you', 'c2')).toBe(done);
  });

  it('stops being on screen once it is answered, and only that step', () => {
    const answered = withStepRecorded(shown, 'you', { status: 'answered', reply: 'Trey', chatId: 'c1', at: AT });
    expect(answered.current).toBeUndefined();
    const other = withStepRecorded(shown, 'identity', { status: 'answered', reply: 'Rye', chatId: 'c1', at: AT });
    expect(other.current).toEqual({ step: 'you', chatId: 'c1' });
  });

  it('is skipped when the person sends a message in its chat instead', () => {
    expect(withMessageSent(shown, 'c1', AT)).toEqual({ steps: { you: { status: 'skipped', chatId: 'c1', at: AT } } });
  });

  it('is left alone by a message in another chat, or with nothing on screen', () => {
    expect(withMessageSent(shown, 'c2', AT)).toBeNull();
    expect(withMessageSent({ steps: {} }, 'c1', AT)).toBeNull();
  });

  it('never skips the harness, which a new home cannot do without', () => {
    expect(withMessageSent(withStepShown({ steps: {} }, 'harness', 'c1'), 'c1', AT)).toBeNull();
  });
});

describe('withFinished', () => {
  const partway: OnboardingRecord = {
    current: { step: 'apps', chatId: 'c1' },
    steps: { identity: { status: 'answered', reply: 'Rye', chatId: 'c1', at: AT } },
  };

  it('fills every unfinished step, so only a step added later is ever new', () => {
    const finished = withFinished(partway, { skipped: false, chatId: 'c1', at: AT });
    expect(Object.keys(finished.steps).sort()).toEqual([...ONBOARDING_STEPS].sort());
    expect(finished.steps.identity?.status).toBe('answered');
    expect(finished.steps.apps).toEqual({ status: 'not_asked', chatId: 'c1', at: AT });
    expect(finished.current).toBeUndefined();
  });

  it('marks what was left as skipped when they chose Skip setup', () => {
    expect(withFinished(partway, { skipped: true, at: AT }).steps.apps).toEqual({ status: 'skipped', at: AT });
  });
});

describe('withChatMoved', () => {
  it('takes the conversation, and the question on screen, to the chat that replaced it', () => {
    const record: OnboardingRecord = {
      current: { step: 'you', chatId: 'old' },
      steps: {
        identity: { status: 'answered', reply: 'Rye', chatId: 'old', at: AT },
        harness: { status: 'answered', reply: '', chatId: 'elsewhere', at: AT },
      },
    };
    expect(withChatMoved(record, 'old', 'new')).toEqual({
      current: { step: 'you', chatId: 'new' },
      steps: {
        identity: { status: 'answered', reply: 'Rye', chatId: 'new', at: AT },
        harness: { status: 'answered', reply: '', chatId: 'elsewhere', at: AT },
      },
    });
  });
});

it('clamps a reply to what is kept', () => {
  expect(clampReply('short')).toBe('short');
  const long = clampReply('x'.repeat(ONBOARDING_REPLY_MAX + 50));
  expect(long).toHaveLength(ONBOARDING_REPLY_MAX);
  expect(long.endsWith('…')).toBe(true);
});
