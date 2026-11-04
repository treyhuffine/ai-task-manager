/**
 * Links from My Ri to a record in a connected team (docs/team-links.md).
 *
 * A link names a Home and an ID and nothing else, so it can't carry a title
 * anywhere or outlive access. Reading one asks that team, as this person's
 * member, using the title lookup that never counts as a view. Writing goes the
 * other way: text bound for a team is checked here, where private records can
 * be seen, because the team can't tell a private ID from a typo.
 */

import * as q from '@/lib/db/queries';
import { remoteMarkerText, splitRemoteId, type RemoteRecordKind } from '@/lib/entity-refs/parse-markers';
import { rpcQuery } from '@/lib/trpc/request-options';
import { assertCurrentTeam, recordTeamFailure, teamFor, TeamConnectionChangedError, type ConnectedTeam } from './connect';
import { teamRequestProblem } from './remote';
import { isNotFound } from './sync';

export interface TeamRecordView {
  state: 'found' | 'gone' | 'unreachable' | 'outdated' | 'no_access' | 'unknown_home';
  homeId: string;
  teamName: string | null;
  /** The team's, when it answered. Otherwise a shared copy's, if there is one. */
  title: string | null;
  status: string | null;
  /** This Ri's shared copy, to open in place of the team's view. */
  localId: string | null;
}

export type LocatedRecord =
  | { state: 'local'; id: string; title: string | null; status: string | null }
  | { state: 'team'; record: TeamRecordView }
  | { state: 'missing'; unreachable: string[] };

/** A chip can say a team can't be reached sooner than a request would give up. */
const TEAM_LINK_WAIT_MS = 5_000;

function sharedCopy(kind: RemoteRecordKind, homeId: string, id: string) {
  if (kind === 'task') return q.getTaskProjection(homeId, id);
  if (kind === 'note') return q.getNoteProjection(homeId, id);
  return null;
}

/** What the team says, or null when it has no such record. */
async function askTeam(team: ConnectedTeam, kind: RemoteRecordKind, id: string): Promise<{ title: string | null; status: string | null } | null> {
  const signal = AbortSignal.timeout(TEAM_LINK_WAIT_MS);
  if (kind === 'area') {
    try {
      const area = await team.client.areas.get.query({ id }, { signal });
      return area.id === id ? { title: area.name, status: area.status } : null;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }
  const { titles } = await team.client.entities.titlesGet.query({ query: { refs: `${kind}:${id}` } }, { signal });
  // Only an answer about the record asked for. A team doesn't get to name others.
  const title = titles.find((candidate) => candidate.type === kind && candidate.id === id);
  return title ? { title: title.title, status: title.status } : null;
}

function localRecord(kind: RemoteRecordKind, id: string): { title: string | null; status: string | null } | null {
  if (kind === 'task') return q.getTask(id) ?? null;
  if (kind === 'note') return q.getNote(id) ?? null;
  const area = q.getArea(id);
  return area ? { title: area.name, status: area.status } : null;
}

/** Whether this ID names anything in this Home, whatever kind a link calls it. */
function isInThisHome(id: string): boolean {
  return !!(q.getTask(id) ?? q.getNote(id) ?? q.getArea(id) ?? q.getWorkspace(id) ?? q.getChatSession(id) ?? q.getDeck(id));
}

/** The ID a team knows a record by, if this is a shared copy of one of that team's. */
function teamIdOf(id: string, teamId: string): string | null {
  const task = q.getTask(id);
  if (task) return task.sourceTeamId === teamId ? task.sourceTaskId : null;
  const note = q.getNote(id);
  return note?.sourceTeamId === teamId ? note.sourceNoteId : null;
}

/** One record in one team, with what to say when it can't be read. */
export async function readTeamRecord(kind: RemoteRecordKind, homeId: string, recordId: string): Promise<TeamRecordView> {
  const connection = q.getTeamConnection(homeId);
  if (!connection) return { state: 'unknown_home', homeId, teamName: null, title: null, status: null, localId: null };
  // An ID in this Home is not the team's, and never goes to it. An agent that
  // paired the team with a shared copy's local ID meant the team's record.
  const id = isInThisHome(recordId) ? teamIdOf(recordId, homeId) : recordId;
  if (!id) return { state: 'gone', homeId, teamName: connection.name, title: null, status: null, localId: null };
  const copy = sharedCopy(kind, homeId, id);
  const fromCopy = (state: TeamRecordView['state']): TeamRecordView => ({
    state,
    homeId,
    teamName: connection.name,
    title: copy?.title ?? null,
    status: copy?.status ?? null,
    localId: copy?.id ?? null,
  });
  const team = await teamFor(homeId);
  if (!team) return fromCopy('no_access');
  try {
    const found = await askTeam(team, kind, id);
    assertCurrentTeam(team);
    if (!found) return fromCopy('gone');
    // A copy that stopped being this person's work rests archived, so the team has the live one.
    return { state: 'found', homeId, teamName: connection.name, ...found, localId: copy?.sourceState === 'active' ? copy.id : null };
  } catch (err) {
    if (err instanceof TeamConnectionChangedError) return fromCopy('no_access');
    const problem = teamRequestProblem(err);
    // A refused key ends the connection, whoever noticed. Anything else belongs to
    // this one chip: the banner on shared work is for what sync finds.
    if (problem?.problem === 'signed_out') {
      recordTeamFailure(homeId, err, team);
      return fromCopy('no_access');
    }
    if (problem?.problem === 'protocol') return fromCopy('outdated');
    if (problem && problem.problem !== 'local') return fromCopy('unreachable');
    throw err;
  }
}

/**
 * Where a bare ID that didn't resolve really is. Old chats and agents that
 * skipped `ref` write team IDs bare, and this finds those. A record in this
 * Home stops the search first, so a private ID is never sent to a team.
 */
export async function locateRecord(kind: RemoteRecordKind, id: string): Promise<LocatedRecord> {
  const local = localRecord(kind, id);
  if (local) return { state: 'local', id, title: local.title, status: local.status };
  if (isInThisHome(id)) return { state: 'missing', unreachable: [] };
  const connections = q.listTeamConnections();
  for (const connection of connections) {
    if (sharedCopy(kind, connection.id, id)) return { state: 'team', record: await readTeamRecord(kind, connection.id, id) };
  }
  const reads = connections
    .filter((connection) => connection.status === 'active')
    .map((connection) => readTeamRecord(kind, connection.id, id).catch(() => null));
  // The first team that has it answers, without waiting on one that's offline.
  const found = await Promise.any(reads.map(async (read) => {
    const record = await read;
    if (record?.state !== 'found') throw new Error('Not in this team.');
    return record;
  })).catch(() => null);
  if (found) return { state: 'team', record: found };
  const answers = await Promise.all(reads);
  return {
    state: 'missing',
    unreachable: answers.filter((answer) => answer?.state === 'unreachable' || answer?.state === 'outdated').map((answer) => answer!.teamName!),
  };
}

export interface TeamRecordMatch {
  kind: 'task' | 'note';
  id: string;
  title: string;
  status?: string;
}

/** The `@` menu in a shared body: that team's records, by their team IDs. */
export async function searchTeamRecords(teamId: string, query: string): Promise<TeamRecordMatch[]> {
  const team = await teamFor(teamId);
  if (!team) return [];
  try {
    const results = await team.client.search.list.query({ query: rpcQuery({ q: query, mode: 'keyword', limit: 8 }) });
    assertCurrentTeam(team);
    return results.flatMap((result) => result.entityType === 'task' || result.entityType === 'note'
      ? [{ kind: result.entityType, id: result.id, title: result.title ?? '', status: result.status ?? undefined }]
      : []);
  } catch (err) {
    if (err instanceof TeamConnectionChangedError) return [];
    const problem = teamRequestProblem(err);
    if (problem?.problem === 'signed_out') recordTeamFailure(teamId, err, team);
    if (problem && problem.problem !== 'local') return [];
    throw err;
  }
}

/** Every marker that names a record, in any form. Agents are told all of these are valid. */
const RECORD_MARKER = /\[\[(task|note|area|deck|execution|agent):([^\]\n]*)\]\]/g;

/**
 * Text as a team should read it. A bare ID in team text means that team's
 * record, so a shared copy's local ID becomes the team's, and this team's own
 * `ref` becomes bare. A link to anything else is `refused`: a private record,
 * or another team's, which teammates can't open.
 *
 * This reads the raw text, code formatting included. What counts as code isn't
 * something a privacy check can get wrong: an editor may draw a chip where a
 * parser saw code.
 */
export function linksForTeam(text: string, teamId: string): { text: string; refused: string[] } {
  const refused: string[] = [];
  const translated = text.replace(RECORD_MARKER, (raw: string, kind: string, value: string) => {
    const remote = splitRemoteId(value);
    if (remote && remote.homeId !== teamId) {
      refused.push(raw);
      return raw;
    }
    const id = remote?.id ?? value;
    const bare = `[[${kind}:${id}]]`;
    // Not in this Home, so it's the team's own ID, or nothing either side can open.
    if (!isInThisHome(id)) return bare;
    const teamRecordId = teamIdOf(id, teamId);
    if (teamRecordId) return `[[${kind}:${teamRecordId}]]`;
    refused.push(raw);
    return raw;
  });
  return { text: translated, refused };
}

/** `linksForTeam` over every string in a write, however deep. */
export function teamTextFields<T>(fields: T, teamId: string): { fields: T; refused: string[] } {
  const refused: string[] = [];
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const translated = linksForTeam(value, teamId);
      refused.push(...translated.refused);
      return translated.text;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, walk(field)]));
    return value;
  };
  return { fields: walk(fields) as T, refused };
}

/** Why a write was refused, for whoever wrote it to fix. */
export function privateLinkMessage(teamName: string, refused: string[]): string {
  return `Nothing was sent to ${teamName}. This text links to a record its teammates can't open: ${[...new Set(refused)].join(', ')}. Remove the link, or describe what you meant in words.`;
}

function recordKindOf(key: string | null, value: Record<string, unknown>): RemoteRecordKind | null {
  // A team's answer is untrusted, and an ID outside the grammar could break out of the marker.
  if (typeof value.id !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(value.id)) return null;
  if (value.type === 'task' || value.type === 'note') return value.type;
  if (key === 'area' || (typeof value.link === 'string' && /[?&]area=/.test(value.link))) return 'area';
  return null;
}

/**
 * A team tool's result with a `ref` on each record it names, the marker to
 * write in Ri. Added here so it works with a team on any version.
 */
export function withRecordRefs(homeId: string, value: unknown, key: string | null = null): unknown {
  if (Array.isArray(value)) return value.map((item) => withRecordRefs(homeId, item, key));
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(record)) out[name] = withRecordRefs(homeId, field, name);
  const kind = recordKindOf(key, record);
  if (kind) out.ref = remoteMarkerText(kind, homeId, record.id as string);
  return out;
}
