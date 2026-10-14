/**
 * Shared work in My Ri (docs/homes-spec.md §9.3-§9.4, P7.2): the home reads,
 * from each connected team, the tasks assigned to this person and the ones
 * they added to their work, and keeps a row for each in My Ri.
 *
 * - Assigned tasks appear without an import or organization step, labelled
 *   with their team. No Area, agent or Deck placement comes with them.
 * - A task added deliberately stays while the person keeps it, assigned or
 *   not, and adding never changes its assignment.
 * - A task reassigned away and never added leaves their work: it rests
 *   archived, its private planning kept. Deleted at the team, it's marked
 *   source unavailable.
 * - Only what changed is read in full. A team that refuses the key ends the
 *   connection, one out of reach is an outage, and either way the private
 *   planning stays.
 */

import * as q from '@/lib/db/queries';
import { perfScope } from '@/lib/perf/recorder';
import { processState } from '@/lib/process-state';
import type { NoteRecord, SharedNoteSource, SharedSourceState, SharedTaskSource, TaskRecord } from '@/db/types';
import { TASK_STATUSES } from '@/lib/tasks/lifecycle';
import { assertCurrentTeam, recordTeamFailure, teamFor, TeamConnectionChangedError, type ConnectedTeam } from './connect';
import { bodyForDocument } from './document';
import { teamRequestProblem, type TeamClient } from './remote';
export { teamSyncGeneration } from './generation';

/** Bound each response without silently dropping older obligations. */
const ASSIGNED_PAGE_SIZE = 500;

export type TeamTask = Awaited<ReturnType<TeamClient['tasks']['get']['query']>>;
export type TeamNote = Awaited<ReturnType<TeamClient['notes']['get']['query']>>;

async function assignedTasks(team: ConnectedTeam) {
  const tasks = new Map<string, Awaited<ReturnType<TeamClient['tasks']['list']['query']>>[number]>();
  for (let offset = 0; ; offset += ASSIGNED_PAGE_SIZE) {
    const page = await team.client.tasks.list.query({
      assigneeMemberId: team.connection.memberId, status: [...TASK_STATUSES],
      limit: ASSIGNED_PAGE_SIZE, offset, orderBy: 'createdAt',
    });
    assertCurrentTeam(team);
    const before = tasks.size;
    for (const task of page) tasks.set(task.id, task);
    if (page.length < ASSIGNED_PAGE_SIZE) return [...tasks.values()];
    if (tasks.size === before) throw new q.TeamError('invalid', 'The team repeated a page of assigned work. Update the team and try again.');
  }
}

function isNotFound(err: unknown): boolean {
  const data = (err as { data?: { code?: string; httpStatus?: number } })?.data;
  return data?.code === 'NOT_FOUND' || data?.httpStatus === 404;
}

/** What My Ri keeps of a team task: its shared fields, its files reached through this home. */
export function sharedFields(teamId: string, task: TeamTask) {
  return {
    title: task.title,
    description: task.description ?? null,
    body: task.body != null ? bodyForDocument(task.body, teamId) : null,
    outcome: task.outcome ?? null,
    hardDeadline: task.hardDeadline ?? null,
    status: task.status,
  };
}

/**
 * What My Ri keeps of a saved team note, its kind included (§9.7): a
 * decision at the team is a decision here. A team that predates kinds says
 * nothing, and the cached kind stays.
 */
export function sharedNoteFields(teamId: string, note: TeamNote): q.SharedNoteFields {
  const kind = (note as { kind?: unknown }).kind;
  return {
    title: note.title ?? null,
    body: bodyForDocument(note.body ?? '', teamId),
    url: note.url ?? null,
    ...(kind === 'note' || kind === 'decision' ? { kind } : {}),
  };
}

export interface TeamSyncResult {
  teamId: string;
  ok: boolean;
  /** Tasks this person has from the team after the pass. */
  active: number;
  /** Rows in My Ri this pass changed: a viewer reloads its lists when any did. */
  changed: number;
  problem?: string;
}

/** Whether a fresh read of a team task says anything the row doesn't already. */
function moved(row: TaskRecord | undefined, source: SharedTaskSource, state: SharedSourceState): boolean {
  if (!row) return true;
  const was = row.source;
  return (
    row.sourceState !== state ||
    !was ||
    was.updatedAt !== source.updatedAt ||
    was.assigned !== source.assigned ||
    was.area?.id !== source.area?.id ||
    was.area?.name !== source.area?.name ||
    was.assignee?.id !== source.assignee?.id ||
    was.assignee?.name !== source.assignee?.name
  );
}

/** One pass over one team. Safe to run again at any time. */
export async function syncTeam(teamId: string): Promise<TeamSyncResult> {
  const team = await teamFor(teamId);
  if (!team) return { teamId, ok: false, active: 0, changed: 0, problem: "This team isn't connected." };
  const { client, connection } = team;
  try {
    const [me, members, areas, assigned] = await Promise.all([
      client.team.me.query(),
      client.team.members.query(),
      client.areas.list.query({ status: 'all' }),
      assignedTasks(team),
    ]);
    assertCurrentTeam(team);
    const memberName = new Map(members.map((m) => [m.id, m.name]));
    const areaName = new Map(areas.map((a) => [a.id, a.name]));
    const now = new Date().toISOString();

    const cached = new Map(q.listTaskProjections(teamId).map((row) => [row.sourceTaskId!, row]));
    const assignedIds = new Set(assigned.map((t) => t.id));

    // Read in full what's new or changed, every task added deliberately (it
    // may have moved without being assigned to this person), and any that
    // stopped being assigned, to tell reassigned from deleted. A renamed
    // team Area or member changes no task, so their names are compared too.
    const toRead = new Set<string>();
    for (const task of assigned) {
      const row = cached.get(task.id);
      const areaNow = task.areaId ? (areaName.get(task.areaId) ?? 'Area') : null;
      const assigneeNow = task.assigneeMemberId ? (memberName.get(task.assigneeMemberId) ?? 'Someone') : null;
      if (
        !row ||
        row.sourceState !== 'active' ||
        row.source?.updatedAt !== task.updatedAt ||
        (row.source?.area?.name ?? null) !== areaNow ||
        (row.source?.assignee?.name ?? null) !== assigneeNow
      ) {
        toRead.add(task.id);
      }
    }
    for (const row of cached.values()) {
      // Deleted at the team is final: one gone isn't asked for again. One
      // cleared by a disconnect is, so a reconnect brings it back.
      if (row.source?.goneAt) continue;
      if (row.source?.addedAt || (row.sourceState === 'active' && !assignedIds.has(row.sourceTaskId!))) toRead.add(row.sourceTaskId!);
    }

    let changed = 0;
    for (const id of toRead) {
      let row = q.getTaskProjection(teamId, id) ?? undefined;
      let task: TeamTask;
      try {
        task = await client.tasks.get.query({ id });
      } catch (err) {
        assertCurrentTeam(team);
        if (!isNotFound(err)) throw err;
        if (row) {
          // Marked gone either way, so it isn't asked for again.
          if (row.sourceState !== 'unavailable') changed++;
          markUnavailable(row);
        }
        continue;
      }
      assertCurrentTeam(team);
      // The person may have added or removed the reference while this read waited.
      row = q.getTaskProjection(teamId, id) ?? undefined;
      const isAssigned = task.assigneeMemberId === connection.memberId;
      const addedAt = row?.source?.addedAt ?? null;
      const source: SharedTaskSource = {
        assigned: isAssigned,
        addedAt,
        bodyRevision: task.bodyRevision,
        statusChangedCount: task.statusChangedCount,
        updatedAt: task.updatedAt,
        syncedAt: now,
        area: task.areaId ? { id: task.areaId, name: areaName.get(task.areaId) ?? 'Area' } : null,
        assignee: task.assigneeMemberId ? { id: task.assigneeMemberId, name: memberName.get(task.assigneeMemberId) ?? 'Someone' } : null,
      };
      const state: SharedSourceState = isAssigned || addedAt ? 'active' : 'released';
      // A task added deliberately is read every pass. Unchanged, it stays as it is.
      if (!moved(row, source, state)) continue;
      q.saveTaskProjection({ teamId, sourceTaskId: id, fields: sharedFields(teamId, task), source, state });
      changed++;
    }

    // Saved notes, each read again: a note changed at the team shows its
    // new text, and one gone from the team says so.
    for (const row of q.listNoteProjections(teamId)) {
      if (row.sourceState === 'released' || row.source?.goneAt || !row.sourceNoteId) continue;
      let note: TeamNote;
      try {
        note = await client.notes.get.query({ id: row.sourceNoteId });
      } catch (err) {
        assertCurrentTeam(team);
        if (!isNotFound(err)) throw err;
        // Marked gone either way, so it isn't asked for again.
        if (row.sourceState !== 'unavailable') changed++;
        q.saveNoteProjection({ teamId, sourceNoteId: row.sourceNoteId, fields: { title: row.title, body: '', url: null }, source: { ...noteSource(row, now), goneAt: now }, state: 'unavailable' });
        continue;
      }
      assertCurrentTeam(team);
      if (q.getNote(row.id)?.sourceState === 'released') continue;
      const area = note.areaId ? { id: note.areaId, name: areaName.get(note.areaId) ?? 'Area' } : null;
      if (row.sourceState === 'active' && row.source?.updatedAt === note.updatedAt && row.source.area?.id === area?.id && row.source.area?.name === area?.name) continue;
      q.saveNoteProjection({
        teamId,
        sourceNoteId: note.id,
        fields: sharedNoteFields(teamId, note),
        source: { addedAt: row.source?.addedAt ?? now, bodyRevision: note.bodyRevision, updatedAt: note.updatedAt, syncedAt: now, area },
        state: 'active',
      });
      changed++;
    }

    q.updateTeamConnection(teamId, {
      name: me.team.name,
      memberName: me.member.name,
      role: me.member.role,
      lastSyncedAt: now,
      lastError: null,
      lastErrorAt: null,
    });
    const active = q.listTaskProjections(teamId).filter((r) => r.sourceState === 'active').length;
    return { teamId, ok: true, active, changed };
  } catch (err) {
    if (err instanceof TeamConnectionChangedError) return { teamId, ok: false, active: 0, changed: 0, problem: err.message };
    const problem = recordTeamFailure(teamId, err, team) ?? teamRequestProblem(err);
    if (!problem) throw err;
    return { teamId, ok: false, active: 0, changed: 0, problem: problem.message };
  }
}

function keepSource(row: TaskRecord): SharedTaskSource {
  return row.source ?? { assigned: false, addedAt: null, bodyRevision: 0, statusChangedCount: 0, updatedAt: row.updatedAt, syncedAt: row.updatedAt, area: null, assignee: null };
}

function cachedFields(row: TaskRecord) {
  return {
    title: row.title,
    description: row.description,
    body: row.body,
    outcome: row.outcome,
    hardDeadline: row.hardDeadline,
    status: row.status,
  };
}

function markUnavailable(row: TaskRecord) {
  q.saveTaskProjection({
    teamId: row.sourceTeamId!,
    sourceTaskId: row.sourceTaskId!,
    fields: cachedFields(row),
    source: { ...keepSource(row), assigned: false, goneAt: new Date().toISOString() },
    state: 'unavailable',
  });
}

function noteSource(row: NoteRecord, now: string): SharedNoteSource {
  return row.source ? { ...row.source, syncedAt: now } : { addedAt: row.createdAt, bodyRevision: 0, updatedAt: row.updatedAt, syncedAt: now, area: null };
}

/** Every connected team, one after another. */
export async function syncAllTeams(): Promise<TeamSyncResult[]> {
  const results: TeamSyncResult[] = [];
  for (const connection of q.listTeamConnections()) {
    if (connection.status !== 'active') continue;
    results.push(await syncTeam(connection.id));
  }
  return results;
}

/**
 * Add a team task to this person's work, assigned or not (§9.3). Its
 * assignment at the team doesn't change, and adding it twice is adding it
 * once. Removing it later leaves a task still assigned to them where it is.
 */
export async function addTeamTaskToMyWork(teamId: string, taskId: string): Promise<TaskRecord> {
  const team = await teamFor(teamId);
  if (!team) throw new q.TeamError('not_found', "This team isn't connected to My Ri.");
  let task: TeamTask;
  try {
    task = await team.client.tasks.get.query({ id: taskId });
  } catch (err) {
    if (isNotFound(err)) throw new q.TeamError('not_found', 'That task is no longer in the team.');
    const problem = recordTeamFailure(teamId, err, team);
    if (problem) throw new q.TeamError('not_found', problem.message);
    throw err;
  }
  const row = q.getTaskProjection(teamId, taskId);
  const now = new Date().toISOString();
  const [members, areas] = await Promise.all([team.client.team.members.query(), team.client.areas.list.query({ status: 'all' })]);
  assertCurrentTeam(team);
  const assigned = task.assigneeMemberId === team.connection.memberId;
  return q.saveTaskProjection({
    teamId,
    sourceTaskId: taskId,
    fields: sharedFields(teamId, task),
    source: {
      assigned,
      addedAt: row?.source?.addedAt ?? now,
      bodyRevision: task.bodyRevision,
      statusChangedCount: task.statusChangedCount,
      updatedAt: task.updatedAt,
      syncedAt: now,
      area: task.areaId ? { id: task.areaId, name: areas.find((a) => a.id === task.areaId)?.name ?? 'Area' } : null,
      assignee: task.assigneeMemberId ? { id: task.assigneeMemberId, name: members.find((m) => m.id === task.assigneeMemberId)?.name ?? 'Someone' } : null,
    },
    state: 'active',
  });
}

/** Stop keeping a team task this person added. One still assigned to them stays. */
export function removeTeamTaskFromMyWork(teamId: string, taskId: string): TaskRecord | null {
  const row = q.getTaskProjection(teamId, taskId);
  if (!row) return null;
  const source = { ...keepSource(row), addedAt: null };
  return q.saveTaskProjection({
    teamId,
    sourceTaskId: taskId,
    fields: cachedFields(row),
    source,
    state: source.assigned && row.sourceState !== 'unavailable' ? 'active' : row.sourceState === 'unavailable' ? 'unavailable' : 'released',
  });
}

/**
 * Save a team note alongside personal notes (§9.3): a reference to the
 * team's note, not a second editable copy. Saving it twice is saving it once.
 */
export async function saveTeamNoteToMyNotes(teamId: string, noteId: string): Promise<NoteRecord> {
  const team = await teamFor(teamId);
  if (!team) throw new q.TeamError('not_found', "This team isn't connected to My Ri.");
  let note: TeamNote;
  try {
    note = await team.client.notes.get.query({ id: noteId });
  } catch (err) {
    if (isNotFound(err)) throw new q.TeamError('not_found', 'That note is no longer in the team.');
    const problem = recordTeamFailure(teamId, err, team);
    if (problem) throw new q.TeamError('not_found', problem.message);
    throw err;
  }
  const row = q.getNoteProjection(teamId, noteId);
  const now = new Date().toISOString();
  const areas = note.areaId ? await team.client.areas.list.query({ status: 'all' }) : [];
  assertCurrentTeam(team);
  return q.saveNoteProjection({
    teamId,
    sourceNoteId: noteId,
    fields: sharedNoteFields(teamId, note),
    source: {
      addedAt: row?.sourceState === 'active' && row.source?.addedAt ? row.source.addedAt : now,
      bodyRevision: note.bodyRevision,
      updatedAt: note.updatedAt,
      syncedAt: now,
      area: note.areaId ? { id: note.areaId, name: areas.find((a) => a.id === note.areaId)?.name ?? 'Area' } : null,
    },
    state: 'active',
  });
}

/** Stop keeping a saved team note. The team's note is unchanged. */
export function removeTeamNoteFromMyNotes(teamId: string, noteId: string): NoteRecord | null {
  const row = q.getNoteProjection(teamId, noteId);
  if (!row) return null;
  return q.saveNoteProjection({
    teamId,
    sourceNoteId: noteId,
    fields: { title: row.title, body: '', url: null },
    source: noteSource(row, new Date().toISOString()),
    state: row.sourceState === 'unavailable' ? 'unavailable' : 'released',
  });
}

// ─── When the home reads its teams ────────────────────────────
// Every two minutes, and when a viewer comes back to the window (§9.3, poll
// and refresh on focus). One pass at a time: a request during a pass waits
// for it, and requests closer together than `minIntervalMs` share one. Each
// pass that changes My Ri moves `generation` on, so an open window can tell
// a pass it didn't ask for changed its lists.

const SYNC_INTERVAL_MS = 2 * 60_000;

const syncState = processState('spaces:sync', () => ({
  timer: null as ReturnType<typeof setInterval> | null,
  running: null as Promise<TeamSyncResult[]> | null,
  lastStartedAt: 0,
  lastResults: [] as TeamSyncResult[],
}));

export function requestTeamSync({ minIntervalMs = 20_000 }: { minIntervalMs?: number } = {}): Promise<TeamSyncResult[]> {
  if (syncState.running) return syncState.running;
  if (Date.now() - syncState.lastStartedAt < minIntervalMs) return Promise.resolve(syncState.lastResults);
  syncState.lastStartedAt = Date.now();
  syncState.running = perfScope('timer:team-sync', () => syncAllTeams())
    .then((results) => {
      syncState.lastResults = results;
      return results;
    })
    .catch((err: unknown) => {
      console.warn('[teams] sync failed', err);
      return [];
    })
    .finally(() => {
      syncState.running = null;
    });
  return syncState.running;
}

/** Start reading connected teams in the background. A personal home's only. */
export function startTeamSync(): void {
  if (syncState.timer) return;
  void requestTeamSync({ minIntervalMs: 0 });
  syncState.timer = setInterval(() => void requestTeamSync({ minIntervalMs: 0 }), SYNC_INTERVAL_MS);
  syncState.timer.unref?.();
}
