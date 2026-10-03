import { describe, expect, it } from 'vitest';
import { FIRST_PROGRESS, listJoin, nextStep, progressStorageKey, readProgress, stepsThrough, type StepContext } from './onboarding-flow';

const NEW_HOME: StepContext = { needsHarness: true, importFound: true, hasDescription: false, hasAreas: false, hasAgents: false };
const SET_UP_HOME: StepContext = { needsHarness: false, importFound: false, hasDescription: true, hasAreas: true, hasAgents: true };

function walk(ctx: StepContext) {
  const steps = ['identity'];
  while (steps[steps.length - 1] !== 'done') steps.push(nextStep(steps[steps.length - 1] as never, ctx));
  return steps;
}

describe('nextStep', () => {
  it('walks a new home through everything', () => {
    expect(walk(NEW_HOME)).toEqual(['identity', 'harness', 'you', 'import', 'about', 'areas', 'apps', 'agent', 'done']);
  });

  it('asks a home that is set up only what it lacks', () => {
    expect(walk(SET_UP_HOME)).toEqual(['identity', 'you', 'apps', 'done']);
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

describe('stepsThrough', () => {
  it('shows the finished steps and the current one', () => {
    expect(stepsThrough('import', { identity: 'Rye', you: 'Trey' })).toEqual(['identity', 'you', 'import']);
  });

  it('leaves out steps skipped over and steps finished without a word', () => {
    expect(stepsThrough('apps', { identity: 'Rye', harness: '', you: 'Trey', import: '', about: 'x' })).toEqual([
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
