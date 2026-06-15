import { describe, expect, it } from 'vitest';
import { parseEntityReferences } from './entity-reference';

describe('parseEntityReferences', () => {
  it('parses all five entity kinds', () => {
    const text =
      'See [[task:0192f3a1-7b2c-7d4e-8f1a-2b3c4d5e6f7a]] and [[execution:019e9911-1111-7222-8333-444455556666]].';
    const segments = parseEntityReferences(text);
    const entities = segments.filter((s) => s.type === 'entity');
    expect(entities).toHaveLength(2);
    expect(entities[0].entityType).toBe('task');
    expect(entities[1].entityType).toBe('execution');
    expect(entities[1].entityId).toBe('019e9911-1111-7222-8333-444455556666');
  });

  it('leaves unknown kinds as plain text', () => {
    const segments = parseEntityReferences('a [[widget:123]] b');
    expect(segments.every((s) => s.type === 'text')).toBe(true);
  });

  it('fast-paths marker-free text into a single segment', () => {
    const segments = parseEntityReferences('no markers here');
    expect(segments).toEqual([{ type: 'text', content: 'no markers here' }]);
  });
});
