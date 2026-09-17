import { describe, expect, it } from 'vitest';
import { appendDeckItem, prependDeckItem, toPersistedDeckItems } from './quick-add';
import type { DeckItem } from '@/types/dashboard';

function item(overrides: Partial<DeckItem> & { taskId: string }): DeckItem {
  return {
    id: overrides.taskId,
    title: 'Task',
    rationale: '',
    ...overrides,
  };
}

describe('appendDeckItem', () => {
  it('appends a task that is not already on the deck', () => {
    const items = [item({ taskId: 'a' })];
    const next = appendDeckItem(items, item({ taskId: 'b' }));
    expect(next.map(i => i.taskId)).toEqual(['a', 'b']);
  });

  it('is a no-op (same reference) when the task is already on the deck', () => {
    // This is the guard against duplicate deck membership: a repeated event or a
    // retry after a partial failure must not list one task twice.
    const items = [item({ taskId: 'a' }), item({ taskId: 'b' })];
    const next = appendDeckItem(items, item({ taskId: 'a', title: 'Re-added' }));
    expect(next).toBe(items);
    expect(next).toHaveLength(2);
  });

  it('does not mutate the input array', () => {
    const items = [item({ taskId: 'a' })];
    appendDeckItem(items, item({ taskId: 'b' }));
    expect(items.map(i => i.taskId)).toEqual(['a']);
  });
});

describe('prependDeckItem', () => {
  it('places a new task at the top of the stack', () => {
    const items = [item({ taskId: 'a' }), item({ taskId: 'b' })];
    const next = prependDeckItem(items, item({ taskId: 'c' }));
    expect(next.map(i => i.taskId)).toEqual(['c', 'a', 'b']);
  });

  it('is a no-op (same reference) when the task is already on the deck', () => {
    const items = [item({ taskId: 'a' }), item({ taskId: 'b' })];
    const next = prependDeckItem(items, item({ taskId: 'b' }));
    expect(next).toBe(items);
  });

  it('does not mutate the input array', () => {
    const items = [item({ taskId: 'a' })];
    prependDeckItem(items, item({ taskId: 'b' }));
    expect(items.map(i => i.taskId)).toEqual(['a']);
  });
});

describe('toPersistedDeckItems', () => {
  it('marks a manually added task as source "user" and an AI pick as "ai"', () => {
    const persisted = toPersistedDeckItems([
      item({ taskId: 'a', rationale: 'top priority' }),
      item({ taskId: 'b', manuallyAdded: true, rationale: '' }),
    ]);
    expect(persisted).toEqual([
      { taskId: 'a', rationale: 'top priority', continuityContext: null, source: 'ai' },
      { taskId: 'b', rationale: '', continuityContext: null, source: 'user' },
    ]);
  });

  it('defaults a missing continuityContext to null (not undefined)', () => {
    const [persisted] = toPersistedDeckItems([item({ taskId: 'a' })]);
    expect(persisted.continuityContext).toBeNull();
  });

  it('preserves an existing continuityContext', () => {
    const [persisted] = toPersistedDeckItems([
      item({ taskId: 'a', continuityContext: 'Last session: got OAuth working' }),
    ]);
    expect(persisted.continuityContext).toBe('Last session: got OAuth working');
  });

  it('round-trips the full array so the rest of the deck is preserved on every write', () => {
    const items = [item({ taskId: 'a' }), item({ taskId: 'b' }), item({ taskId: 'c', manuallyAdded: true })];
    const persisted = toPersistedDeckItems(items);
    expect(persisted.map(p => p.taskId)).toEqual(['a', 'b', 'c']);
  });
});
