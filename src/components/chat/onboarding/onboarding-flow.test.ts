import { describe, expect, it } from 'vitest';
import { FIRST_PROGRESS, listJoin, nextStep, progressStorageKey, readProgress, stepsThrough, type StepContext } from './onboarding-flow';

const NEW_HOME: StepContext = { needsHarness: true, importFound: true, hasAreas: false, hasAgents: false };
const SET_UP_HOME: StepContext = { needsHarness: false, importFound: false, hasAreas: true, hasAgents: true };

function walk(ctx: StepContext) {
  const steps = ['identity'];
  while (steps[steps.length - 1] !== 'done') steps.push(nextStep(steps[steps.length - 1] as never, ctx));
  return steps;
}

describe('nextStep', () => {
  it('walks a new home through everything', () => {
    expect(walk(NEW_HOME)).toEqual(['identity', 'harness', 'you', 'about', 'import', 'areas', 'apps', 'agent', 'done']);
  });

  it('asks a home that is set up only what it lacks', () => {
    expect(walk(SET_UP_HOME)).toEqual(['identity', 'you', 'about', 'apps', 'done']);
  });

  it('still shows import while the search is running', () => {
    expect(nextStep('about', { ...SET_UP_HOME, importFound: null })).toBe('import');
  });

  it('skips import when there is nothing to bring in', () => {
    expect(nextStep('about', { ...NEW_HOME, importFound: false })).toBe('areas');
  });

  it('stays done', () => {
    expect(nextStep('done', NEW_HOME)).toBe('done');
  });
});

describe('stepsThrough', () => {
  it('shows the finished steps and the current one', () => {
    expect(stepsThrough('about', { identity: 'Rye', you: 'Trey' })).toEqual(['identity', 'you', 'about']);
  });

  it('leaves out steps skipped over and steps finished without a word', () => {
    expect(stepsThrough('apps', { identity: 'Rye', harness: '', you: 'Trey', about: 'x' })).toEqual([
      'identity',
      'you',
      'about',
      'apps',
    ]);
  });
});

describe('readProgress', () => {
  it('starts over on nothing saved or anything that does not parse', () => {
    expect(readProgress(null)).toEqual(FIRST_PROGRESS);
    expect(readProgress('{')).toEqual(FIRST_PROGRESS);
    expect(readProgress('{"step":"somewhere"}')).toEqual(FIRST_PROGRESS);
  });

  it('keeps the step and only text replies, the silent one included', () => {
    expect(readProgress(JSON.stringify({ step: 'apps', replies: { identity: 'Rye', harness: '', you: 7, nope: 'x' } }))).toEqual({
      step: 'apps',
      replies: { identity: 'Rye', harness: '' },
    });
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

describe('progressStorageKey', () => {
  it('keeps each home apart, so a new home never resumes an old one', () => {
    expect(progressStorageKey('home-a')).not.toBe(progressStorageKey('home-b'));
  });
});
