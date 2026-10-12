import { describe, expect, it } from 'vitest';
import { buildDeckPrompt } from './deck-generation';

const base = {
  tasks: [{ id: 't1', title: 'Ship the thing', timesDeferred: 0 }],
  areas: [],
  recentCompletions: [],
  generationContext: {},
};

describe('buildDeckPrompt — DECK.md instruction injection', () => {
  it('injects the instructions under [Your Source Instructions]', () => {
    const prompt = buildDeckPrompt({
      ...base,
      deckInstructions: 'Use my Google Calendar me@company.com for work events.',
    });
    expect(prompt).toContain('[Your Source Instructions]');
    expect(prompt).toContain('Use my Google Calendar me@company.com for work events.');
  });

  it('omits the section when there are no instructions', () => {
    const prompt = buildDeckPrompt(base);
    expect(prompt).not.toContain('[Your Source Instructions]');
  });

  it('still includes the task list (instructions don\'t crowd out core context)', () => {
    const prompt = buildDeckPrompt({ ...base, deckInstructions: 'do the thing' });
    expect(prompt).toContain('Ship the thing');
    expect(prompt).toContain('[Active Tasks');
  });
});

describe('buildDeckPrompt — shared team work (docs/homes-spec.md §9.3)', () => {
  it('names the team and why the task is this person’s, and nothing for personal tasks', () => {
    const prompt = buildDeckPrompt({
      ...base,
      tasks: [
        { id: 't1', title: 'Ship the thing', timesDeferred: 0 },
        { id: 't2', title: 'Fix the login loop', timesDeferred: 0, team: { name: 'Acme', assigned: true } },
        { id: 't3', title: 'Research SSO', timesDeferred: 0, team: { name: 'Acme', assigned: false } },
      ],
    });
    expect(prompt).toContain('team: Acme (assigned to you)');
    expect(prompt).toContain('team: Acme (you added it)');
    expect(prompt.split('\n').find((line) => line.includes('Ship the thing'))).not.toContain('team:');
  });
});
