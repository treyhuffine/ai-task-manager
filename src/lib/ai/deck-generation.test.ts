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
