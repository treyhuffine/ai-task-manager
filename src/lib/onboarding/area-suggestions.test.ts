import { describe, expect, it } from 'vitest';
import { areaSuggestionPrompt, tidyAreaSuggestions } from './area-suggestions';

describe('tidyAreaSuggestions', () => {
  it('trims, drops repeats and keeps at most four', () => {
    expect(
      tidyAreaSuggestions([
        { name: '  Ri  ', emoji: '🌀' },
        { name: 'ri', emoji: '🌀' },
        { name: 'Running', emoji: '🏃' },
        { name: 'Personal', emoji: '🏡' },
        { name: 'Family', emoji: '👨‍👩‍👧' },
        { name: 'Extra', emoji: '➕' },
      ]),
    ).toEqual([
      { name: 'Ri', emoji: '🌀' },
      { name: 'Running', emoji: '🏃' },
      { name: 'Personal', emoji: '🏡' },
      { name: 'Family', emoji: '👨‍👩‍👧' },
    ]);
  });

  it('never passes on a sparkle, star or magic wand', () => {
    expect(
      tidyAreaSuggestions([
        { name: 'Personal', emoji: '✨' },
        { name: 'Goals', emoji: '⭐' },
        { name: 'Magic', emoji: '🪄' },
        { name: 'Shine', emoji: '🌟' },
      ]).map((a) => a.emoji),
    ).toEqual(['📁', '📁', '📁', '📁']);
  });

  it('gives a folder to anything that is not an emoji, and drops blank names', () => {
    expect(tidyAreaSuggestions([{ name: 'Work', emoji: 'W' }, { name: ' ', emoji: '💼' }])).toEqual([
      { name: 'Work', emoji: '📁' },
    ]);
  });
});

describe('areaSuggestionPrompt', () => {
  it('carries what they said and the projects they brought in', () => {
    const prompt = areaSuggestionPrompt({ about: 'Building Ri and training for a marathon', projects: ['ri', 'blog'] });
    expect(prompt).toContain('Building Ri and training for a marathon');
    expect(prompt).toContain('Projects they brought in: ri, blog.');
  });
});
