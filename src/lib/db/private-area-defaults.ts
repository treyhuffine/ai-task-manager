import { and, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { TeamError } from './queries';
import { getDb } from '@/lib/db';
import { areas, personalAreaDefaults, referenceAreaChoices, teamConnections } from './schema';
import { assertPersonalCapability } from '@/lib/home/authority';

export function listPersonalAreaDefaults(teamId: string) {
  assertPersonalCapability('Private Area defaults');
  return getDb().select().from(personalAreaDefaults).where(eq(personalAreaDefaults.teamId, teamId)).all();
}

export function setPersonalAreaDefault(input: { teamId: string; sourceAreaId: string | null; areaId: string | null }) {
  assertPersonalCapability('Private Area defaults');
  const db = getDb();
  if (!db.select({ id: teamConnections.id }).from(teamConnections).where(eq(teamConnections.id, input.teamId)).get()) throw new TeamError('not_found', 'Connect this team before setting an Area default.');
  const scope = and(eq(personalAreaDefaults.teamId, input.teamId), input.sourceAreaId === null ? isNull(personalAreaDefaults.sourceAreaId) : eq(personalAreaDefaults.sourceAreaId, input.sourceAreaId));
  return db.transaction((tx) => {
    if (input.areaId === null) {
      tx.delete(personalAreaDefaults).where(scope).run();
      return null;
    }
    const area = tx.select().from(areas).where(eq(areas.id, input.areaId)).get();
    if (!area || area.status === 'archived') throw new TeamError('invalid', 'Choose an active personal Area.');
    const old = tx.select().from(personalAreaDefaults).where(scope).get();
    if (old) return tx.update(personalAreaDefaults).set({ areaId: area.id }).where(eq(personalAreaDefaults.id, old.id)).returning().get()!;
    return tx.insert(personalAreaDefaults).values({ id: uuidv7(), ...input, areaId: area.id }).returning().get()!;
  });
}

/** The source Area must be known active by the authenticated import. */
export function defaultPersonalArea(teamId: string, activeSourceAreaId: string | null): string | null {
  const candidates = getDb().select({ rule: personalAreaDefaults, status: areas.status }).from(personalAreaDefaults)
    .innerJoin(areas, eq(areas.id, personalAreaDefaults.areaId)).where(eq(personalAreaDefaults.teamId, teamId)).all()
    .filter((r) => r.status !== 'archived');
  return (candidates.find((r) => activeSourceAreaId !== null && r.rule.sourceAreaId === activeSourceAreaId) ?? candidates.find((r) => r.rule.sourceAreaId === null))?.rule.areaId ?? null;
}

export function recordReferenceAreaChoice(entityType: 'task' | 'note', entityId: string, choice: typeof referenceAreaChoices.$inferInsert.choice): void {
  getDb().insert(referenceAreaChoices).values({ id: uuidv7(), entityType, entityId, choice })
    .onConflictDoUpdate({ target: [referenceAreaChoices.entityType, referenceAreaChoices.entityId], set: { choice } }).run();
}

export function referenceAreaChoice(entityType: 'task' | 'note', entityId: string) {
  return getDb().select().from(referenceAreaChoices).where(and(eq(referenceAreaChoices.entityType, entityType), eq(referenceAreaChoices.entityId, entityId))).get()?.choice ?? 'unknown';
}
