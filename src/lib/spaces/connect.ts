/**
 * Connecting a team to My Ri (docs/homes-spec.md §3.1, §9.3, P7.1).
 *
 * The home redeems the link itself, as the same member everywhere:
 *
 * - An invitation joins the team and connects it in one step (Join a team in
 *   My Ri). The person names themselves, as they would in a browser.
 * - A sign-in link connects a team the person already joined directly
 *   (Connect to My Ri): the same member, a key of its own for this home.
 *
 * The team gets no credential for this home and nothing private. The member
 * key is sealed under `<config>/teams`. Reconnecting the same member is
 * idempotent: the same row, a fresh key, the old key signed out. A second
 * member for the same team, or a setup link, is refused and explained.
 */

import { assertPersonalCapability } from '@/lib/home/authority';
import * as q from '@/lib/db/queries';
import type { TeamConnectionRecord } from '@/db/types';
import { normalizeTeamAddress } from '@/lib/team/address';
import { parseTeamLink, type TeamLinkKind } from '@/lib/team/links';
import { forgetTeamKey, readTeamKey, saveTeamKey, teamKeyVersion, teamConnectAttempt } from './credentials';
import { teamProblemMessage, teamRequest, TeamRequestError, teamRequestProblem, teamTRPC, type TeamClient } from './remote';

type GrantState = 'valid' | 'expired' | 'used' | 'revoked' | 'unknown';

export interface TeamLinkSummary {
  kind: 'team';
  link: TeamLinkKind;
  state: GrantState;
  team: { id: string; name: string } | null;
  /** For a sign-in link: whose it is. */
  memberName: string | null;
  /** This Ri's current connection to that team, if it has one. */
  connected: { memberName: string; status: TeamConnectionRecord['status'] } | null;
}

interface ParsedLink {
  origin: string;
  kind: TeamLinkKind;
  secret: string;
}

const REFUSED: Record<Exclude<GrantState, 'valid'>, string> = {
  expired: 'This link has expired. Ask the team for a new one.',
  used: 'This link was already used. Ask the team for a new one.',
  revoked: 'This link was withdrawn. Ask the team for a new one.',
  unknown: "This link isn't valid. Ask the team for a new one.",
};

/** Why a plain HTTP team link is refused, wherever it's pasted. */
export const PLAIN_HTTP_LINK_REFUSED = "Use the team's HTTPS link. Plain HTTP works only for local development.";

function parse(raw: string): ParsedLink {
  const parsed = parseTeamLink(raw.trim());
  if (!parsed) throw new q.TeamError('invalid', "That isn't a team invitation or sign-in link.");
  let origin: string;
  try {
    origin = normalizeTeamAddress(parsed.origin);
  } catch (err) {
    // A pasted link says the same as the desktop's own form does (desktop/team-setup.ts).
    if (parsed.origin.startsWith('http:')) throw new q.TeamError('invalid', PLAIN_HTTP_LINK_REFUSED);
    throw new q.TeamError('invalid', err instanceof Error ? err.message : "That team's address can't be used.");
  }
  return { origin, kind: parsed.kind, secret: parsed.secret };
}

async function readJson<T>(res: Response): Promise<T | null> {
  return (await res.json().catch(() => null)) as T | null;
}

/** Turn a team's refusal into the same error the team gave. */
async function refusal(res: Response): Promise<q.TeamError> {
  const body = await readJson<{ error?: string; message?: string }>(res);
  const code = body?.error;
  const known: q.TeamErrorCode[] = ['invalid', 'expired', 'used', 'revoked', 'not_allowed', 'conflict', 'not_found'];
  if (res.status === 404 && !code) return new q.TeamError('invalid', teamProblemMessage('not_a_team'));
  return new q.TeamError(known.includes(code as q.TeamErrorCode) ? (code as q.TeamErrorCode) : 'invalid', body?.message ?? 'The team refused the link.');
}

async function preview(link: ParsedLink) {
  const res = await teamRequest(`${link.origin}/api/team/public/preview`, {
    method: 'POST',
    body: JSON.stringify({ secret: link.secret, kind: link.kind, attemptId: teamConnectAttempt(link.origin, link.kind, link.secret) }),
  });
  if (!res.ok) throw await refusal(res);
  const body = await readJson<{ kind?: string; state?: GrantState; retry?: boolean; team?: { id: string; name: string } | null; member?: { id: string; name: string } | null }>(res);
  if (body?.kind !== 'team' || !body.state) throw new q.TeamError('invalid', teamProblemMessage('not_a_team'));
  return { state: body.state, retry: body.retry === true, team: body.team ?? null, memberName: body.member?.name ?? null, memberId: body.member?.id ?? null };
}

function asTeamError(err: unknown): never {
  if (err instanceof q.TeamError) throw err;
  const problem = teamRequestProblem(err);
  if (problem) throw new q.TeamError('not_found', problem.message);
  throw err;
}

/** Where a pasted link leads, before anything is joined or saved. */
export async function inspectTeamLink(raw: string): Promise<TeamLinkSummary> {
  assertPersonalCapability('Connecting a team');
  const link = parse(raw);
  try {
    const found = await preview(link);
    const existing = found.team ? q.getTeamConnection(found.team.id) : null;
    return {
      kind: 'team',
      link: link.kind,
      state: found.state,
      team: found.team,
      memberName: found.memberName,
      connected: existing ? { memberName: existing.memberName, status: existing.status } : null,
    };
  } catch (err) {
    asTeamError(err);
  }
}

/** How this home shows among the member's sign-ins at the team: "My Ri on AI Mac Mini". */
function homeDeviceName(): string {
  const home = q.getHome();
  const host = home?.hostDeviceId ? q.getDevice(home.hostDeviceId)?.name?.trim() : null;
  return host ? `My Ri on ${host}` : 'My Ri';
}

/** Join a team with an invitation, or connect one with a sign-in link. */
export async function connectTeam(input: { link: string; name?: string }): Promise<TeamConnectionRecord> {
  assertPersonalCapability('Connecting a team');
  const link = parse(input.link);
  if (link.kind === 'setup') {
    throw new q.TeamError('invalid', 'This link sets up a new team. Open it in a browser to finish, then connect the team here with a sign-in link from its Settings.');
  }
  // The preview is remote work too. Remember local identity before it starts,
  // so a disconnect or competing connect anywhere in this request wins.
  const startedWith = new Map(q.listTeamConnections().map((row) => [row.id, connectionIdentity(row)]));
  try {
    const found = await preview(link);
    if (found.state !== 'valid') throw new q.TeamError(found.state === 'unknown' ? 'invalid' : found.state, REFUSED[found.state]);
    const existing = found.team ? q.getTeamConnection(found.team.id) : null;
    if (existing && existing.status === 'active') {
      // A team is reached where it was connected. A link from anywhere else
      // can't take over that connection, whatever the endpoint says it is:
      // nothing proves an address belongs to a team except the address My Ri
      // already uses. A team that moved is disconnected and connected again.
      if (existing.address !== link.origin) {
        throw new q.TeamError(
          'conflict',
          `This link reaches ${existing.name} somewhere other than ${existing.address}, where this Ri connects to it. If the team moved, disconnect it in Settings, Teams, then connect again with this link.`,
        );
      }
      if (link.kind === 'invite' && !found.retry) {
        throw new q.TeamError('conflict', `This Ri is already connected to ${existing.name} as ${existing.memberName}.`);
      }
      if (found.memberId && found.memberId !== existing.memberId) {
        throw new q.TeamError('conflict', `This Ri is connected to ${existing.name} as ${existing.memberName}. Disconnect it first to connect as ${found.memberName}.`);
      }
    }

    const device = { kind: 'service' as const, name: homeDeviceName() };
    const attemptId = teamConnectAttempt(link.origin, link.kind, link.secret);
    let res: Response;
    if (link.kind === 'invite') {
      const name = input.name?.trim();
      if (!name) throw new q.TeamError('invalid', 'Enter your name. It is what the team sees on your work.');
      res = await teamRequest(`${link.origin}/api/team/public/join`, { method: 'POST', body: JSON.stringify({ secret: link.secret, attemptId, name, device }) });
    } else {
      res = await teamRequest(`${link.origin}/api/team/public/sign-in`, { method: 'POST', body: JSON.stringify({ secret: link.secret, attemptId, device }) });
    }
    if (!res.ok) throw await refusal(res);
    const admitted = await readJson<{ token?: string; member?: { id: string; name: string; role: 'owner' | 'member' }; team?: { id: string; name: string } }>(res);
    if (!admitted?.token || !admitted.member || !admitted.team) throw new q.TeamError('invalid', 'The team answered in a way this Ri does not understand. Update both to the same version.');
    if (!found.team || admitted.team.id !== found.team.id || (found.memberId && admitted.member.id !== found.memberId)) {
      throw new q.TeamError('invalid', 'The team or member changed from the link preview. Open a new link from the team.');
    }
    if (existing && existing.status === 'active' && existing.memberId !== admitted.member.id) {
      await signOutKey(link.origin, admitted.token);
      throw new q.TeamError('conflict', `This Ri is connected to ${existing.name} as ${existing.memberName}. Disconnect it first.`);
    }

    // The team is the one the link named, read with the new key.
    const home = await readJson<{ id?: string; kind?: string; name?: string }>(
      await teamRequest(`${link.origin}/api/home`, { token: admitted.token, teamName: admitted.team.name }),
    );
    if (home?.kind !== 'team' || home.id !== admitted.team.id) {
      await signOutKey(link.origin, admitted.token);
      throw new q.TeamError('invalid', "That address isn't the team the link names.");
    }

    const unchanged = () => {
      if (connectionIdentity(q.getTeamConnection(admitted.team!.id)) !== (startedWith.get(admitted.team!.id) ?? null)) throw new TeamConnectionChangedError();
    };
    const priorConnection = q.getTeamConnection(admitted.team.id);
    const previous = await readTeamKey(admitted.team.id);
    let saved!: TeamConnectionRecord;
    try {
      await saveTeamKey(admitted.team.id, admitted.member.id, admitted.token, {
        assertCurrent: unchanged,
        onSaved: () => {
          saved = q.saveTeamConnection({
            id: admitted.team!.id, name: admitted.team!.name, address: link.origin,
            memberId: admitted.member!.id, memberName: admitted.member!.name, role: admitted.member!.role,
          });
        },
      });
    } catch (err) {
      if (err instanceof TeamConnectionChangedError) {
        const key = await readTeamKey(admitted.team.id);
        const current = q.getTeamConnection(admitted.team.id);
        // Two retries of one admission may share the very same credential.
        // Never sign out the winning request's key while rejecting a loser.
        if (current?.status === 'active' && current.address === link.origin && current.memberId === admitted.member.id && key?.token === admitted.token && key.version === teamKeyVersion(current.id)) return current;
        if (key?.token !== admitted.token) await signOutKey(link.origin, admitted.token);
      }
      throw err;
    }
    // An old key goes only to the address that issued it, never the new link.
    if (priorConnection && previous && previous.token !== admitted.token) await signOutKey(priorConnection.address, previous.token);
    return saved;
  } catch (err) {
    asTeamError(err);
  }
}

/** Ignore background freshness writes, but include every part of local authority. */
function connectionIdentity(row: TeamConnectionRecord | null): string | null {
  return row ? JSON.stringify([row.status, row.address, row.memberId, teamKeyVersion(row.id)]) : null;
}

async function signOutKey(address: string, token: string): Promise<void> {
  try {
    await teamTRPC(address, token).team.signIns.signOut.mutate();
  } catch {
    // Best effort: a key the team already refuses is signed out anyway.
  }
}

/**
 * Stop working with a team from this Ri. Its key is signed out at the team
 * when it can be reached, and forgotten here either way. Shared content this
 * home cached leaves with it. Private planning stays.
 */
export async function disconnectTeam(id: string): Promise<TeamConnectionRecord> {
  assertPersonalCapability('Connecting a team');
  const row = q.getTeamConnection(id);
  if (!row) throw new q.TeamError('not_found', "That team isn't connected to this Ri.");
  const identity = connectionIdentity(row);
  const key = await readTeamKey(id);
  if (identity !== connectionIdentity(q.getTeamConnection(id))) throw new TeamConnectionChangedError();
  forgetTeamKey(id);
  q.releaseTeamContent(id);
  const disconnected = q.updateTeamConnection(id, { status: 'disconnected' }) ?? row;
  if (key) await signOutKey(row.address, key.token);
  return disconnected;
}

export interface ConnectedTeam {
  connection: TeamConnectionRecord;
  client: TeamClient;
  token: string;
  keyVersion: string;
}

export class TeamConnectionChangedError extends q.TeamError {
  constructor() { super('conflict', 'The team connection changed during this request. Open the team again to continue.'); }
}

/** Fence responses from a sign-in that was disconnected or replaced meanwhile. */
export function isCurrentTeam(team: ConnectedTeam): boolean {
  const current = q.getTeamConnection(team.connection.id);
  return current?.status === 'active' && current.memberId === team.connection.memberId &&
    current.address === team.connection.address && teamKeyVersion(current.id) === team.keyVersion;
}

export function assertCurrentTeam(team: ConnectedTeam): void {
  if (!isCurrentTeam(team)) throw new TeamConnectionChangedError();
}

/** A connected team's API, as this home's member. Null when there's no usable key. */
export async function teamFor(id: string): Promise<ConnectedTeam | null> {
  const connection = q.getTeamConnection(id);
  if (!connection || connection.status !== 'active') return null;
  const key = await readTeamKey(id);
  if (!key || key.memberId !== connection.memberId) return null;
  const team = { connection, client: teamTRPC(connection.address, key.token, connection.name), token: key.token, keyVersion: key.version };
  return isCurrentTeam(team) ? team : null;
}

/**
 * Note what a failed exchange with a team means. A key the team refuses
 * ends the connection: nothing more is fetched or written, shared content
 * cached here is cleared, and private planning stays. Anything else is an
 * outage, shown with the last time the team was read.
 */
export function recordTeamFailure(id: string, err: unknown, request?: ConnectedTeam): TeamRequestError | null {
  const problem = teamRequestProblem(err);
  if (!problem) return null;
  if (request && !isCurrentTeam(request)) return problem;
  const now = new Date().toISOString();
  if (problem.problem === 'signed_out') {
    forgetTeamKey(id);
    q.releaseTeamContent(id);
    q.updateTeamConnection(id, { status: 'revoked', lastError: problem.message, lastErrorAt: now });
  } else {
    q.updateTeamConnection(id, { lastError: problem.message, lastErrorAt: now });
  }
  return problem;
}
