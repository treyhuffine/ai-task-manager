import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import { getDb } from '@/lib/db';
import { areas, personalAreaDefaults, referenceAreaChoices } from '@/lib/db/schema';

let home: TestHome;
beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1');
  home = await createTestHome({ prefix: 'ri-unified-areas-' });
  for (const id of ['team-a', 'team-b']) q.saveTeamConnection({ id, name: 'Same name', url: `https://${id}.example`, memberId: 'member', memberName: 'Ada', role: 'member' });
});
afterEach(async () => { await home.cleanup(); vi.unstubAllEnvs(); });

function task(id: string, sourceAreaId: string | null = null, teamId = 'team-a') {
  return q.saveTaskProjection({
    teamId, sourceTaskId: id, activeSourceAreaId: sourceAreaId,
    fields: { title: id, description: null, body: 'Team body', outcome: null, hardDeadline: null, status: 'todo' },
    source: { assigned: true, addedAt: null, bodyRevision: 0, statusChangedCount: 0, updatedAt: '2026-10-19', syncedAt: '2026-10-19', area: sourceAreaId ? { id: sourceAreaId, name: 'Travel' } : null, assignee: null }, state: 'active',
  });
}

describe('private Area defaults', () => {
  it('uses specific then whole-team defaults, keeps imports unranked, and distinguishes same-name teams', () => {
    const family = q.createArea({ name: 'Family' });
    const travel = q.createArea({ name: 'Travel' });
    q.setPersonalAreaDefault({ teamId: 'team-a', sourceAreaId: null, areaId: family.id });
    q.setPersonalAreaDefault({ teamId: 'team-a', sourceAreaId: 'remote-travel', areaId: travel.id });
    expect(task('one', 'remote-travel')).toMatchObject({ areaId: travel.id, sortKey: null });
    expect(task('two', 'other')).toMatchObject({ areaId: family.id, sortKey: null });
    expect(task('three', null, 'team-b').areaId).toBeNull();
    expect(q.listAreas()).toHaveLength(2);
  });

  it('applies note defaults once and preserves a deliberate clear and rank through sync and rule changes', () => {
    const area = q.createArea({ name: 'Family' });
    q.setPersonalAreaDefault({ teamId: 'team-a', sourceAreaId: null, areaId: area.id });
    const first = task('one');
    q.updateTask(first.id, { areaId: null, sortKey: 'a0' }, { source: 'human' });
    expect(task('one')).toMatchObject({ areaId: null, sortKey: 'a0' });
    expect(q.previewPersonalAreaDefault('team-a', null, [])).toEqual([]);
    const input = { teamId: 'team-a', sourceNoteId: 'note', fields: { title: 'Note', body: 'Body', url: null }, source: { addedAt: 'now', bodyRevision: 0, updatedAt: '2026-10-19', syncedAt: 'now', area: null }, state: 'active' as const };
    const note = q.saveNoteProjection(input);
    expect(note.areaId).toBe(area.id);
    q.updateNote(note.id, { areaId: null }, { source: 'human' });
    expect(q.saveNoteProjection(input).areaId).toBeNull();
    expect(q.previewPersonalAreaDefault('team-a', null, [])).toEqual([]);
  });

  it('previews new unorganized work and requires explicit selection for unknown legacy organization', () => {
    const first = task('one');
    const legacy = task('legacy');
    getDb().delete(referenceAreaChoices).where(eq(referenceAreaChoices.entityId, legacy.id)).run();
    const area = q.createArea({ name: 'Family' });
    q.setPersonalAreaDefault({ teamId: 'team-a', sourceAreaId: null, areaId: area.id });
    const preview = q.previewPersonalAreaDefault('team-a', null, []);
    expect(preview.find((r) => r.id === first.id)?.requiresReview).toBe(false);
    expect(preview.find((r) => r.id === legacy.id)?.requiresReview).toBe(true);
    expect(q.applyPersonalAreaDefault('team-a', null, [], preview.filter((r) => !r.requiresReview))).toEqual({ changed: 1 });
    expect(q.getTask(legacy.id)?.areaId).toBeNull();
    q.updateTask(legacy.id, { areaId: null }, { source: 'human' });
    expect(() => q.applyPersonalAreaDefault('team-a', null, [], preview.filter((r) => r.requiresReview))).toThrow(/changed/);
  });

  it('counts duplicate review selections once and disables deleted destinations', () => {
    const first = task('reviewed');
    const area = q.createArea({ name: 'Original name' });
    q.setPersonalAreaDefault({ teamId: 'team-a', sourceAreaId: null, areaId: area.id });
    q.updateArea(area.id, { name: 'Renamed destination' });
    const preview = q.previewPersonalAreaDefault('team-a', null, []);
    expect(q.applyPersonalAreaDefault('team-a', null, [], [...preview, ...preview])).toEqual({ changed: 1 });
    expect(q.getTask(first.id)?.areaId).toBe(area.id);
    q.updateTask(first.id, { areaId: null }, { source: 'human' });
    getDb().delete(areas).where(eq(areas.id, area.id)).run();
    expect(q.listPersonalAreaDefaults('team-a')).toEqual([]);
    expect(task('after-delete').areaId).toBeNull();
  });

  it('disables archived destinations and inactive source rules, preserves rules on reconnect, and enforces null-scope uniqueness', () => {
    const base = q.createArea({ name: 'Base' });
    const specific = q.createArea({ name: 'Specific' });
    q.setPersonalAreaDefault({ teamId: 'team-a', sourceAreaId: null, areaId: base.id });
    q.setPersonalAreaDefault({ teamId: 'team-a', sourceAreaId: 'remote', areaId: specific.id });
    q.updateArea(specific.id, { status: 'archived' });
    expect(task('one', 'remote').areaId).toBe(base.id);
    q.updateTeamConnection('team-a', { status: 'disconnected' });
    q.updateTeamConnection('team-a', { status: 'active', name: 'Renamed' });
    expect(q.listPersonalAreaDefaults('team-a')).toHaveLength(2);
    expect(task('two').areaId).toBe(base.id);
    expect(() => getDb().insert(personalAreaDefaults).values({ id: 'duplicate', teamId: 'team-a', sourceAreaId: null, areaId: base.id }).run()).toThrow(/UNIQUE/);
    expect(getDb().all(sql`PRAGMA foreign_key_check`)).toEqual([]);
  });
});
