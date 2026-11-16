/**
 * Repeating tasks and the Deck: a task done for now stays off the generated
 * stack until the local day of its next occurrence, and comes back that day,
 * whatever the UTC clock says (src/lib/tasks/recurrence.ts).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { todayLocalDate } from '@/lib/deck/date';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

let home: TestHome;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-deck-recurrence-' });
});

afterEach(async () => {
  await home.cleanup();
});

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

describe('the Deck and repeating tasks', () => {
  it('draws a repeating task on the day it is due and never while it rests', async () => {
    const q = await import('@/lib/db/queries');
    const { readyDeckCandidates } = await import('@/lib/ai/generate-deck');
    const today = todayLocalDate();
    const fresh = q.createTask({ title: 'Never done yet', rawInput: 'x', recurrence: 'weekly' });
    const dueToday = q.createTask({ title: 'Due today', rawInput: 'x', recurrence: 'weekly', nextRecurrenceAt: today });
    const overdue = q.createTask({ title: 'Missed last week', rawInput: 'x', recurrence: 'weekly', nextRecurrenceAt: addDays(today, -7) });
    const resting = q.createTask({ title: 'Next week', rawInput: 'x', recurrence: 'weekly', nextRecurrenceAt: addDays(today, 7) });
    const justDone = q.createTask({ title: 'Done just now', rawInput: 'x', recurrence: 'daily' });
    q.completeTask(justDone.id, { idempotencyKey: 'done', meta: { source: 'human' } });

    const ids = readyDeckCandidates(new Date()).map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining([fresh.id, dueToday.id, overdue.id]));
    expect(ids).not.toContain(resting.id);
    expect(ids).not.toContain(justDone.id);

    // The local day it comes due, from its first minute.
    const [y, m, d] = addDays(today, 1).split('-').map(Number);
    const tomorrow = readyDeckCandidates(new Date(y, m - 1, d, 0, 1)).map((t) => t.id);
    expect(tomorrow).toContain(justDone.id);
    expect(tomorrow).not.toContain(resting.id);
  });
});
