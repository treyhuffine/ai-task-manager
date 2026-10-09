/**
 * The task, note and Area surface in a team space (docs/homes-spec.md §9.1,
 * §9.4, P6.2/P6.4). The same procedures and query functions serve a
 * personal home and a team. In a team they also:
 *
 * - act as the signed-in member, recorded on every version and status
 *   change ("Trey changed this"),
 * - change only the fields the team shares. Planning fields (energy,
 *   effort, snooze, reminders, private context, subtasks, agent and
 *   execution links) belong to each person's own Ri (§9.4), so a team record
 *   never holds them,
 * - assign only to the team's active members,
 * - require a shared body write to name the body revision it edited, so a
 *   stale autosave is refused with the current text instead of replacing it,
 * - run no AI and keep no personal viewing state on the shared record.
 */

import type { RequestKey } from '@/lib/auth/request-key';
import { getMember, TeamError, type EntityVersionMeta, type LifecycleActorMeta } from '@/lib/db/queries';
import { isTeamAuthority } from '@/lib/home/authority';

/** Who is acting on shared work: the owner of a personal home, or a team member. */
export type SharedCaller = { team: false } | { team: true; memberId: string; role: 'owner' | 'member' };

export function sharedCaller(key: RequestKey | null): SharedCaller {
  if (!isTeamAuthority()) return { team: false };
  if (!key || key.scope !== 'member' || !key.memberId || !key.memberRole) {
    throw new TeamError('not_allowed', 'Sign in as a member of this team.');
  }
  return { team: true, memberId: key.memberId, role: key.memberRole };
}

/** Provenance for a version: a person acting through the app. */
export function versionMeta(caller: SharedCaller): EntityVersionMeta {
  return caller.team ? { source: 'human', actorMemberId: caller.memberId } : { source: 'human' };
}

export function lifecycleMeta(caller: SharedCaller, base: Omit<LifecycleActorMeta, 'source' | 'actorMemberId'> = {}): LifecycleActorMeta {
  return caller.team ? { ...base, source: 'human', actorMemberId: caller.memberId } : { ...base, source: 'human' };
}

/** What a team's task shares. Everything else is a person's own planning (§9.4). */
export const TEAM_TASK_FIELDS = [
  'title',
  'description',
  'body',
  'outcome',
  'areaId',
  'assigneeMemberId',
  'hardDeadline',
  'attachments',
] as const;

/** What a team's note shares. */
export const TEAM_NOTE_FIELDS = ['title', 'body', 'areaId', 'url', 'status', 'attachments'] as const;

/** What a team's Area keeps: how the team organizes, never anyone's private context. */
export const TEAM_AREA_FIELDS = ['name', 'description', 'emoji', 'notes', 'status', 'sortOrder', 'attachments'] as const;

const TASK_FIELDS = new Set<string>(TEAM_TASK_FIELDS);
const NOTE_FIELDS = new Set<string>(TEAM_NOTE_FIELDS);
const AREA_FIELDS = new Set<string>(TEAM_AREA_FIELDS);

/** Fields a team's create may set, beyond the shared ones: how the record began. */
const TASK_CREATE_EXTRAS = new Set(['rawInput', 'status']);

function refuseFields(kind: 'task' | 'note' | 'Area', fields: string[]): never {
  throw new TeamError(
    'invalid',
    `A team's ${kind} doesn't keep ${fields.join(', ')}. Those belong to each person's own Ri.`,
  );
}

/** Keep a team task's change to its shared fields, and check who it's assigned to. */
export function assertTeamTaskPatch(patch: Record<string, unknown>, mode: 'create' | 'update'): void {
  const extra = Object.keys(patch).filter((field) => !TASK_FIELDS.has(field) && !(mode === 'create' && TASK_CREATE_EXTRAS.has(field)));
  if (extra.length) refuseFields('task', extra);
  assertAssignable(patch.assigneeMemberId);
}

export function assertTeamNotePatch(patch: Record<string, unknown>): void {
  const extra = Object.keys(patch).filter((field) => !NOTE_FIELDS.has(field));
  if (extra.length) refuseFields('note', extra);
}

export function assertTeamAreaPatch(patch: Record<string, unknown>): void {
  const extra = Object.keys(patch).filter((field) => !AREA_FIELDS.has(field));
  if (extra.length) refuseFields('Area', extra);
}

/** Only an active member can be assigned. Unassigning is always fine. */
export function assertAssignable(memberId: unknown): void {
  if (memberId === undefined || memberId === null) return;
  if (typeof memberId !== 'string') throw new TeamError('invalid', 'Choose someone in the team.');
  const member = getMember(memberId);
  if (!member || member.status !== 'active') throw new TeamError('invalid', "That person isn't in the team.");
}

/**
 * A shared body is only written against the revision it edited (§9.3). The
 * personal app may still write without one, as before.
 */
export function requireBodyRevision(caller: SharedCaller, patch: Record<string, unknown>, expected: number | undefined): void {
  if (!caller.team || !Object.prototype.hasOwnProperty.call(patch, 'body')) return;
  if (expected === undefined) {
    throw new TeamError('invalid', 'A change to shared text has to say which version it edited. Reload and try again.');
  }
}
