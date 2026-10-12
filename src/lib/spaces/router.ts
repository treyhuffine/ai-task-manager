/**
 * My Ri's teams (docs/homes-spec.md §3.1, §9.3, P7.1): the ones this home is
 * connected to, joining one with an invitation, connecting one already
 * joined with a sign-in link, and disconnecting. The personal owner's only.
 * Nothing here returns a team's key.
 */

import { z } from 'zod/v4';
import * as q from '@/lib/db/queries';
import type { TeamConnectionRecord } from '@/db/types';
import { router, viewerProcedure as p } from '@/lib/trpc/init';
import { attachment } from '@/lib/trpc/schemas';
import { publishSharedTaskResult, sharedTaskPublishedResults } from './commands';
import { connectTeam, disconnectTeam, inspectTeamLink, teamFor } from './connect';
import {
  addTeamTaskToMyWork,
  removeTeamNoteFromMyNotes,
  removeTeamTaskFromMyWork,
  requestTeamSync,
  saveTeamNoteToMyNotes,
  teamSyncGeneration,
} from './sync';

const linkInput = z.object({ link: z.string().trim().min(1).max(2000) }).strict();
const idInput = z.object({ id: z.string().min(1).max(100) }).strict();
const teamTaskInput = z.object({ teamId: z.string().min(1).max(100), taskId: z.string().min(1).max(100) }).strict();
const localTaskInput = z.object({ taskId: z.string().min(1).max(100) }).strict();
const publishInput = z.object({
  taskId: z.string().min(1).max(100),
  requestId: z.string().min(1).max(200),
  summary: z.string().max(20_000).nullable().optional(),
  link: z.object({ label: z.string().trim().min(1).max(200), url: z.string().trim().min(1).max(2000) }).strict().nullable().optional(),
  personalAttachments: z.array(attachment).max(10).optional(),
  teamAttachments: z.array(attachment).max(10).optional(),
}).strict();

/** A task in My Ri that's shared with a team, or refused. */
function sharedTask(id: string) {
  const task = q.getTask(id);
  if (!task?.sourceTeamId) throw new q.TeamError('not_found', "That isn't a task shared with a team.");
  return task;
}

const teamNoteInput = z.object({ teamId: z.string().min(1).max(100), noteId: z.string().min(1).max(100) }).strict();

export interface TeamConnectionView {
  id: string;
  name: string;
  address: string;
  memberId: string;
  memberName: string;
  role: TeamConnectionRecord['role'];
  status: TeamConnectionRecord['status'];
  connectedAt: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

export function teamConnectionView(row: TeamConnectionRecord): TeamConnectionView {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    memberId: row.memberId,
    memberName: row.memberName,
    role: row.role,
    status: row.status,
    connectedAt: row.createdAt,
    lastSyncedAt: row.lastSyncedAt,
    lastError: row.lastError,
    lastErrorAt: row.lastErrorAt,
  };
}

export const spacesRouter = router({
  list: p.query(() => q.listTeamConnections().map(teamConnectionView)),
  /** Where a pasted link leads, before anything is joined or saved. */
  inspectLink: p.input(linkInput).mutation(({ input }) => inspectTeamLink(input.link)),
  connect: p
    .input(linkInput.extend({ name: z.string().trim().max(200).optional() }))
    .mutation(async ({ input }) => {
      const connection = await connectTeam(input);
      // Its work for this person arrives now, not at the next pass.
      void requestTeamSync({ minIntervalMs: 0 });
      return teamConnectionView(connection);
    }),
  disconnect: p.input(idInput).mutation(async ({ input }) => teamConnectionView(await disconnectTeam(input.id))),
  /** Read the connected teams again: a viewer came back to the window. */
  refresh: p.mutation(async () => {
    const results = await requestTeamSync();
    return {
      generation: teamSyncGeneration(),
      teams: results.map(({ teamId, ok, active, changed, problem }) => ({ teamId, ok, active, changed, problem: problem ?? null })),
    };
  }),
  /** Whether a pass changed My Ri since a window last looked. Cheap, for polling. */
  generation: p.query(() => ({ generation: teamSyncGeneration() })),
  /** Whether a team task is in this person's work, and why. */
  myWork: p.input(teamTaskInput).query(({ input }) => {
    const row = q.getTaskProjection(input.teamId, input.taskId);
    const active = row?.sourceState === 'active';
    return { taskId: active ? row.id : null, inMyWork: active, assigned: !!row?.source?.assigned, added: !!row?.source?.addedAt };
  }),
  addToMyWork: p.input(teamTaskInput).mutation(async ({ input }) => ({ taskId: (await addTeamTaskToMyWork(input.teamId, input.taskId)).id })),
  removeFromMyWork: p.input(teamTaskInput).mutation(({ input }) => {
    removeTeamTaskFromMyWork(input.teamId, input.taskId);
    return { ok: true as const };
  }),
  /** Whether a team note is saved in this person's notes. */
  noteSaved: p.input(teamNoteInput).query(({ input }) => {
    const row = q.getNoteProjection(input.teamId, input.noteId);
    const saved = row?.sourceState === 'active';
    return { noteId: saved ? row.id : null, saved };
  }),
  /** Who a result published to this team reaches: everyone in it (§9.5). */
  // Typed here, not inferred from the team's client, whose types are this router's own.
  audience: p.input(idInput).query(async ({ input }): Promise<{ team: string; members: { id: string; name: string }[] }> => {
    const team = await teamFor(input.id);
    if (!team) throw new q.TeamError('not_found', "This team isn't connected to My Ri.");
    const members: { id: string; name: string; active: boolean }[] = await team.client.team.members.query();
    return { team: team.connection.name, members: members.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name })) };
  }),
  /** Publish a chosen result to a shared task's team. */
  publishResult: p.input(publishInput).mutation(({ input: { taskId, ...rest } }) => publishSharedTaskResult(sharedTask(taskId), rest)),
  /** What's been published to a shared task's team. */
  publishedResults: p.input(localTaskInput).query(({ input }) => sharedTaskPublishedResults(sharedTask(input.taskId))),
  saveNote: p.input(teamNoteInput).mutation(async ({ input }) => ({ noteId: (await saveTeamNoteToMyNotes(input.teamId, input.noteId)).id })),
  removeNote: p.input(teamNoteInput).mutation(({ input }) => {
    removeTeamNoteFromMyNotes(input.teamId, input.noteId);
    return { ok: true as const };
  }),
});
