import { describe, expect, it } from 'vitest';
import { summarizeDeckChanges } from './change-summary';

describe('summarizeDeckChanges', () => {
  it('counts carried, new, and moved-off in display order', () => {
    const { parts } = summarizeDeckChanges([
      { kind: 'carried' },
      { kind: 'carried' },
      { kind: 'added' },
      { kind: 'deferred' },
      { kind: 'dropped' },
      { kind: 'bumped' },
    ]);
    expect(parts).toEqual(['2 carried over', '1 new', '3 moved off']);
  });

  it('omits empty buckets and ignores reorders', () => {
    const { parts } = summarizeDeckChanges([{ kind: 'carried' }, { kind: 'reordered' }]);
    expect(parts).toEqual(['1 carried over']);
  });

  it('is empty for no changes', () => {
    expect(summarizeDeckChanges([])).toEqual({ parts: [], fromCalendar: false });
  });

  it('flags a calendar-sourced change', () => {
    expect(summarizeDeckChanges([{ kind: 'bumped', source: 'calendar' }]).fromCalendar).toBe(true);
    expect(summarizeDeckChanges([{ kind: 'bumped', source: 'reconcile' }]).fromCalendar).toBe(false);
  });
});
