import { describe, expect, it } from 'vitest';
import { listNonFileMarkers, parseEntitySegments, referencesEntity } from './parse-markers';

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

  it('leaves agents out: their chips draw from the agent list, not the session\'s references', () => {
    expect(referencesEntity('ask [[agent:01a0f1c2-0000-7000-8000-000000000001]]')).toBe(false);
  });
});

describe('agent markers', () => {
  const id = '01a0f1c2-0000-7000-8000-000000000001';

  it('split out of the message in place, like a task', () => {
    expect(parseEntitySegments(`ask [[agent:${id}]] about [[task:t1]]`)).toEqual([
      { kind: 'text', text: 'ask ' },
      { kind: 'marker', marker: { kind: 'agent', id }, raw: `[[agent:${id}]]` },
      { kind: 'text', text: ' about ' },
      { kind: 'marker', marker: { kind: 'task', id: 't1' }, raw: '[[task:t1]]' },
    ]);
    expect(listNonFileMarkers(`[[agent:${id}]] [[file:a.png]]`)).toEqual([{ kind: 'agent', id }]);
  });

  it('stay text without an id', () => {
    expect(parseEntitySegments('[[agent]] [[agent:]]')).toEqual([
      { kind: 'text', text: '[[agent]]' },
      { kind: 'text', text: ' [[agent:]]' },
    ]);
  });
});
