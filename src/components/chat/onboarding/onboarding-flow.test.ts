import { describe, expect, it } from 'vitest';
import { FIRST_PROGRESS, listJoin, nextStep, readProgress, stepsThrough } from './onboarding-flow';

describe('nextStep', () => {
  it('walks name, you, what you do, apps, an agent, done', () => {
    const walk = ['identity'];
    while (walk[walk.length - 1] !== 'done') walk.push(nextStep(walk[walk.length - 1] as never, { hasAgents: false }));
    expect(walk).toEqual(['identity', 'you', 'about', 'apps', 'agent', 'done']);
  });

  it('skips adding an agent for someone who has one', () => {
    expect(nextStep('apps', { hasAgents: true })).toBe('done');
  });

  it('stays done', () => {
    expect(nextStep('done', { hasAgents: false })).toBe('done');
  });
});

describe('stepsThrough', () => {
  it('shows the finished steps and the current one', () => {
    expect(stepsThrough('about', { identity: 'Rye', you: 'Trey' })).toEqual(['identity', 'you', 'about']);
  });

  it('leaves out a step that was skipped over', () => {
    expect(stepsThrough('done', { identity: 'Rye', you: 'Trey', about: 'x', apps: 'Not now' })).toEqual([
      'identity',
      'you',
      'about',
      'apps',
      'done',
    ]);
  });
});

describe('readProgress', () => {
  it('starts over on nothing saved or anything that does not parse', () => {
    expect(readProgress(null)).toEqual(FIRST_PROGRESS);
    expect(readProgress('{')).toEqual(FIRST_PROGRESS);
    expect(readProgress('{"step":"somewhere"}')).toEqual(FIRST_PROGRESS);
  });

  it('keeps the step and only text replies', () => {
    expect(readProgress(JSON.stringify({ step: 'apps', replies: { identity: 'Rye', you: 7, nope: 'x' } }))).toEqual({
      step: 'apps',
      replies: { identity: 'Rye' },
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
