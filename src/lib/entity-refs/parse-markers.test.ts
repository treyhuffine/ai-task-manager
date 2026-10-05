import { describe, expect, it } from 'vitest';
import { referencesEntity } from './parse-markers';

describe('referencesEntity', () => {
  it('finds a task or note reference', () => {
    expect(referencesEntity('[[task:01a10837-9062-79d7-bbc3-7baf98a60b9b]] Can we build this?')).toBe(true);
    expect(referencesEntity('see [[note:abc_1.2]] for context')).toBe(true);
  });

  it('ignores files, the scratchpad, malformed markers and empty text', () => {
    expect(referencesEntity('[[file:01a1.png]] and [[scratchpad]]')).toBe(false);
    expect(referencesEntity('[[task:]] [[task]] task:abc')).toBe(false);
    expect(referencesEntity('')).toBe(false);
    expect(referencesEntity(null)).toBe(false);
  });
});
