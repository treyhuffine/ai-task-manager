import { describe, expect, it } from 'vitest';
import { ONBOARDING_STEPS, type OnboardingRecord, type OnboardingStepName } from '@/lib/onboarding/progress';
import {
  STEP_ORDER,
  STEP_TITLES,
  doneSteps,
  listJoin,
  nextStep,
  openSteps,
  repliesInConversation,
  stepsInConversation,
  stepsOnFile,
  type StepContext,
} from './onboarding-flow';

const NEW_HOME: StepContext = { needsHarness: true, importFound: true, hasDescription: false, hasAreas: false, hasAgents: false };
const SET_UP_HOME: StepContext = { needsHarness: false, importFound: false, hasDescription: true, hasAreas: true, hasAgents: true };
const NONE: ReadonlySet<OnboardingStepName> = new Set();
const AT = '2026-10-06T12:00:00.000Z';

function walk(ctx: StepContext, done: ReadonlySet<OnboardingStepName> = NONE) {
  const steps: string[] = [];
  let step = nextStep(null, ctx, done);
  steps.push(step);
  while (step !== 'done') {
    step = nextStep(step, ctx, done);
    steps.push(step);
  }
  return steps;
}

it('asks every stored step, in the order the conversation goes', () => {
  expect(STEP_ORDER.filter((s) => s !== 'done').sort()).toEqual([...ONBOARDING_STEPS].sort());
  expect(Object.keys(STEP_TITLES).sort()).toEqual([...ONBOARDING_STEPS].sort());
});

describe('nextStep', () => {
  it('walks a new home through everything', () => {
    expect(walk(NEW_HOME)).toEqual(['identity', 'harness', 'you', 'import', 'about', 'areas', 'apps', 'agent', 'done']);
  });

  it('asks a home that is set up only what it lacks', () => {
    expect(walk(SET_UP_HOME)).toEqual(['identity', 'you', 'apps', 'done']);
  });

  it('passes over what is already done, wherever it was done', () => {
    expect(walk(SET_UP_HOME, new Set(['identity', 'you']))).toEqual(['apps', 'done']);
    expect(walk(NEW_HOME, new Set(['identity', 'harness', 'import']))).toEqual(['you', 'about', 'areas', 'apps', 'agent', 'done']);
  });

  it('still shows import while the search is running', () => {
    expect(nextStep('you', { ...SET_UP_HOME, importFound: null })).toBe('import');
  });

  it('never asks what you work on as a blank box: no history, no question', () => {
    expect(nextStep('you', { ...NEW_HOME, importFound: false })).toBe('areas');
  });

  it('does not ask what you work on when it is already known', () => {
    expect(nextStep('import', { ...NEW_HOME, hasDescription: true })).toBe('areas');
  });

  it('does not ask for a first agent while an import is bringing some in', () => {
    expect(nextStep('apps', { ...NEW_HOME, importingAgents: true })).toBe('done');
  });

  it('stays done', () => {
    expect(nextStep('done', NEW_HOME)).toBe('done');
  });
});

describe('what is done', () => {
  it('counts a name already on file, so a home that answered before is not asked again', () => {
    expect(stepsOnFile({ name: 'Trey', orchestratorName: 'Rye' })).toEqual(new Set(['identity', 'you']));
    expect(stepsOnFile({ orchestratorEmoji: '🍞' })).toEqual(new Set(['identity']));
    expect(stepsOnFile({ name: '  ', orchestratorName: null })).toEqual(new Set());
  });

  it('counts every recorded step, answered or not, plus what is on file', () => {
    const record: OnboardingRecord = {
      steps: { apps: { status: 'skipped', chatId: 'c1', at: AT }, about: { status: 'not_asked', at: AT } },
    };
    expect(doneSteps(record, new Set(['you']))).toEqual(new Set(['apps', 'about', 'you']));
  });

  it('leaves open only what applies and is not done', () => {
    expect(openSteps(SET_UP_HOME, new Set(['identity', 'you']))).toEqual(['apps']);
    expect(openSteps(SET_UP_HOME, new Set(['identity', 'you', 'apps']))).toEqual([]);
  });
});

describe('this conversation', () => {
  const record: OnboardingRecord = {
    steps: {
      identity: { status: 'answered', reply: 'Rye', chatId: 'earlier', at: AT },
      harness: { status: 'answered', reply: '', chatId: 'now', at: AT },
      you: { status: 'answered', reply: 'Trey', chatId: 'now', at: AT },
      import: { status: 'skipped', chatId: 'now', at: AT },
      apps: { status: 'not_asked', at: AT },
    },
  };

  it('replays only what was answered in its own chats, in order', () => {
    expect(stepsInConversation(record, new Set(['now']))).toEqual(['harness', 'you']);
    expect(stepsInConversation(record, new Set(['now', 'earlier']))).toEqual(['identity', 'harness', 'you']);
  });

  it('knows what was said at each, a silent harness included', () => {
    expect(repliesInConversation(record, new Set(['now']))).toEqual({ harness: '', you: 'Trey' });
  });
});

describe('listJoin', () => {
  it('reads like a sentence', () => {
    expect(listJoin([])).toBe('');
    expect(listJoin(['Google'])).toBe('Google');
    expect(listJoin(['Google', 'Slack'])).toBe('Google and Slack');
    expect(listJoin(['Google', 'Slack', 'Notion'])).toBe('Google, Slack and Notion');
  });
});
