/**
 * Source filtering in My Ri (docs/homes-spec.md §9.3, P7.4): a list can show
 * My Ri's own tasks, or one connected team's, and its counts agree.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SharedTaskSource } from '@/db/types';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

let home: TestHome;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-p7-source-' });
});

afterEach(async () => {
  await home.cleanup();
});

const now = new Date().toISOString();
const source: SharedTaskSource = { assigned: true, addedAt: null, bodyRevision: 1, statusChangedCount: 0, updatedAt: now, syncedAt: now, area: null, assignee: null };
const fields = (title: string) => ({ title, description: null, body: null, outcome: null, hardDeadline: null, status: 'todo' as const });

describe('source filter', () => {
  it("narrows lists and counts to My Ri's own tasks or one team's", async () => {
    const q = await import('@/lib/db/queries');
    for (const [id, name] of [['acme', 'Acme'], ['family', 'Family']]) {
      q.saveTeamConnection({ id, name, url: `https://${id}.example`, memberId: `m-${id}`, memberName: 'Maya', role: 'member' });
    }
    const mine = q.createTask({ title: 'Mine', rawInput: 'Mine' });
    const acme = q.saveTaskProjection({ teamId: 'acme', sourceTaskId: 'a1', fields: fields('From Acme'), source, state: 'active' });
    const family = q.saveTaskProjection({ teamId: 'family', sourceTaskId: 'f1', fields: fields('From Family'), source, state: 'active' });

    const ids = (filter: Parameters<typeof q.listTasks>[0]) => q.listTasks(filter).map((t) => t.id).sort();
    expect(ids({})).toEqual([mine.id, acme.id, family.id].sort());
    expect(ids({ source: 'personal' })).toEqual([mine.id]);
    expect(ids({ source: 'acme' })).toEqual([acme.id]);
    expect(ids({ source: 'family', status: 'todo' })).toEqual([family.id]);

    expect(q.getTaskStatusCounts({}).todo).toBe(3);
    expect(q.getTaskStatusCounts({ source: 'personal' }).todo).toBe(1);
    expect(q.getTaskStatusCounts({ source: 'acme' }).todo).toBe(1);
  });
});
