/**
 * Shared work and the Deck (docs/homes-spec.md §9.3, P7.4): a team task that
 * is this person's, assigned or added, is eligible under the Deck's existing
 * rules like any other Ready Todo. Arriving never places it on today's Deck,
 * and one that left their work is out of reach.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SharedTaskSource, TaskStatus } from '@/db/types';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

let home: TestHome;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-p7-deck-' });
});

afterEach(async () => {
  await home.cleanup();
});

function source(extra: Partial<SharedTaskSource> = {}): SharedTaskSource {
  const now = new Date().toISOString();
  return { assigned: true, addedAt: null, bodyRevision: 1, statusChangedCount: 0, updatedAt: now, syncedAt: now, area: null, assignee: null, ...extra };
}

function fields(title: string, status: TaskStatus = 'todo') {
  return { title, description: null, body: null, outcome: null, hardDeadline: null, status };
}

describe('the Deck and shared work', () => {
  it('draws from assigned and added team work by its usual rules, never from work that left', async () => {
    const q = await import('@/lib/db/queries');
    q.saveTeamConnection({ id: 'team-1', name: 'Acme', address: 'https://acme.example', memberId: 'm-1', memberName: 'Maya', role: 'member' });
    const personal = q.createTask({ title: 'Personal', rawInput: 'Personal' });
    const assigned = q.saveTaskProjection({ teamId: 'team-1', sourceTaskId: 'a', fields: fields('Assigned'), source: source(), state: 'active' });
    const added = q.saveTaskProjection({ teamId: 'team-1', sourceTaskId: 'b', fields: fields('Added'), source: source({ assigned: false, addedAt: new Date().toISOString() }), state: 'active' });
    const released = q.saveTaskProjection({ teamId: 'team-1', sourceTaskId: 'c', fields: fields('Reassigned away'), source: source({ assigned: false }), state: 'released' });
    const underway = q.saveTaskProjection({ teamId: 'team-1', sourceTaskId: 'd', fields: fields('Underway', 'in_progress'), source: source(), state: 'active' });
    // Snoozed privately: the Deck's own rule applies to shared work too.
    const snoozed = q.saveTaskProjection({ teamId: 'team-1', sourceTaskId: 'e', fields: fields('Snoozed'), source: source(), state: 'active' });
    q.updateTask(snoozed.id, { resurfaceAfter: new Date(Date.now() + 86_400_000).toISOString() }, { source: 'human' });

    const { readyDeckCandidates } = await import('@/lib/ai/generate-deck');
    const ids = readyDeckCandidates(new Date()).map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining([personal.id, assigned.id, added.id]));
    expect(ids).not.toContain(released.id);
    expect(ids).not.toContain(underway.id);
    expect(ids).not.toContain(snoozed.id);
  });

  it('places nothing on the Deck when work arrives', async () => {
    const q = await import('@/lib/db/queries');
    q.saveTeamConnection({ id: 'team-1', name: 'Acme', address: 'https://acme.example', memberId: 'm-1', memberName: 'Maya', role: 'member' });
    expect(q.getLatestDeck()).toBeFalsy();
    q.saveTaskProjection({ teamId: 'team-1', sourceTaskId: 'a', fields: fields('Assigned'), source: source(), state: 'active' });
    expect(q.getLatestDeck()).toBeFalsy();
  });
});
