/**
 * The desktop's team operations, in the trusted ordinary-Node setup helper
 * (docs/homes-spec.md §3.1, P6.2). Never exposed to a renderer. Secrets come
 * in on stdin and the member key goes back to Electron main only.
 *
 * - Reading a Ri link: a pairing link answers as a personal Ri, an
 *   invitation or sign-in link as a team, with the destination's name, before
 *   anything is saved.
 * - Joining a team or signing in to one with its link. A team never gets
 *   local execution, a pairing grant or this computer's personal key.
 * - Creating a team on this computer: a new, separate root marked as a team
 *   before anything starts there, its first owner made locally (retry-safe by
 *   the creation id), then its own service on its own port. Nothing of the
 *   personal installation is read, copied or stopped.
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { parseTeamLink, type TeamLinkKind } from '../src/lib/team/links';

const RESPONSE_LIMIT = 64 * 1024;

export interface TeamLinkSummary {
  kind: 'team';
  origin: string;
  link: TeamLinkKind;
  state: 'valid' | 'expired' | 'used' | 'revoked' | 'unknown';
  teamName: string | null;
  memberName: string | null;
}

export interface JoinedTeam {
  team: { id: string; name: string };
  origin: string;
  member: { id: string; name: string; role: 'owner' | 'member' };
  /** For Electron main only. */
  token: string;
}

export interface HostedTeam extends JoinedTeam {
  root: string;
  created: boolean;
}

function loopback(hostname: string) {
  return hostname === 'localhost' || hostname === '[::1]' || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(hostname);
}

/** A team link the desktop accepts: HTTPS, or loopback HTTP while developing. */
export function parseDesktopTeamLink(raw: string, development = false) {
  const parsed = parseTeamLink(raw);
  if (!parsed) return null;
  const url = new URL(parsed.origin);
  if (url.protocol !== 'https:' && !(development && url.protocol === 'http:' && loopback(url.hostname))) {
    throw new Error("Use the team's HTTPS link. Plain HTTP works only for local development.");
  }
  return parsed;
}

async function teamJson(origin: string, route: string, body: unknown): Promise<{ status: number; data: unknown }> {
  let response: Response;
  try {
    response = await fetch(`${origin}${route}`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', 'x-ri-api-protocol': '1', 'user-agent': 'Ri desktop (Electron)' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error("Ri couldn't reach this team. Check the link and your connection, then try again. Your link is kept.");
  }
  const text = await response.text();
  if (text.length > RESPONSE_LIMIT) throw new Error('The team returned an oversized response.');
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("That address didn't answer as a Ri team.");
  }
  return { status: response.status, data };
}

const previewSchema = z.object({
  kind: z.literal('team'),
  state: z.enum(['valid', 'expired', 'used', 'revoked', 'unknown']),
  team: z.object({ id: z.string(), name: z.string() }).nullable(),
  member: z.object({ name: z.string() }).nullable(),
});

/** What a team link opens, without using it. */
export async function inspectTeamLink(raw: string, development: boolean): Promise<TeamLinkSummary> {
  const link = parseDesktopTeamLink(raw, development);
  if (!link) throw new Error("That isn't a Ri link.");
  const { status, data } = await teamJson(link.origin, '/api/team/public/preview', { kind: link.kind, secret: link.secret });
  const preview = previewSchema.safeParse(data);
  if (status !== 200 || !preview.success) throw new Error("That address didn't answer as a Ri team.");
  return {
    kind: 'team',
    origin: link.origin,
    link: link.kind,
    state: preview.data.state,
    teamName: preview.data.team?.name ?? null,
    memberName: preview.data.member?.name ?? null,
  };
}

const admittedSchema = z.object({
  token: z.string().min(16).max(4096),
  member: z.object({ id: z.string().min(1), name: z.string(), role: z.enum(['owner', 'member']) }),
  team: z.object({ id: z.string().min(1), name: z.string() }),
});

/** Join with an invitation, or sign in with a sign-in link. A team-only connection: nothing else changes here. */
export async function joinTeamWithLink(raw: string, name: string | undefined, development: boolean): Promise<JoinedTeam> {
  const link = parseDesktopTeamLink(raw, development);
  if (!link) throw new Error("That isn't a team link.");
  if (link.kind === 'setup') throw new Error('That link finishes setting up a team. Open it in a browser on the computer that hosts it.');
  const device = { kind: 'computer' as const, name: 'Ri desktop' };
  const { status, data } = link.kind === 'invite'
    ? await teamJson(link.origin, '/api/team/public/join', { secret: link.secret, name: name ?? '', device })
    : await teamJson(link.origin, '/api/team/public/sign-in', { secret: link.secret, device });
  if (status !== 200) {
    const message = typeof (data as { message?: unknown })?.message === 'string' ? (data as { message: string }).message : null;
    throw new Error(message ?? "The team couldn't add you. Ask its owner for a new link.");
  }
  const admitted = admittedSchema.safeParse(data);
  if (!admitted.success) throw new Error("That address didn't answer as a Ri team.");
  return { team: admitted.data.team, origin: link.origin, member: admitted.data.member, token: admitted.data.token };
}

/**
 * Make the team in its own root, from the helper started with that root's
 * environment. Marked first, its identity a team's from the outset, its host
 * key made, then its owner, all retry-safe by the creation id.
 */
export async function createTeamHere(input: { creationId: string; teamName: string; ownerName: string; port?: number }): Promise<Omit<HostedTeam, 'origin'>> {
  const { getAppRoot, getConfigDir } = await import('../src/lib/config/paths');
  const { writeTeamIntent } = await import('../src/lib/home/team-intent');
  writeTeamIntent({ creationId: input.creationId, name: input.teamName });
  if (input.port) {
    const settings = path.join(getConfigDir(), 'local-service.json');
    if (!fs.existsSync(settings)) {
      fs.mkdirSync(path.dirname(settings), { recursive: true, mode: 0o700 });
      fs.writeFileSync(settings, JSON.stringify({ version: 1, port: input.port }), { mode: 0o600 });
    }
  }
  const { ensureHomeIdentity } = await import('../src/lib/home/identity');
  const identity = ensureHomeIdentity();
  if (identity.home.kind !== 'team') throw new Error('That folder holds a personal Ri. Nothing was changed.');
  const { ensureLocalToken } = await import('../src/lib/auth/bootstrap');
  ensureLocalToken();
  const { createTeamOwner, renameTeam } = await import('../src/lib/db/queries');
  const owner = createTeamOwner({ creationId: input.creationId, name: input.ownerName, device: { name: 'Ri desktop', kind: 'computer' } });
  const team = owner.created && input.teamName.trim() && input.teamName.trim() !== identity.home.name ? renameTeam(input.teamName) : identity.home;
  const { resetDb } = await import('../src/lib/db');
  resetDb();
  return {
    root: getAppRoot(),
    team: { id: team.id, name: team.name },
    member: { id: owner.member.id, name: owner.member.name, role: owner.member.role },
    token: owner.token.plaintext,
    created: owner.created,
  };
}

/** Start (or attach to) the team's own service on this computer. Its origin and pinned certificate, never its host key. */
export async function startTeamHere(options: { repo: string; node: string }): Promise<{ origin: string; certificate: string }> {
  const { ensureServiceStatus, serviceRequest } = await import('../src/lib/service/client');
  const status = await ensureServiceStatus({ repo: options.repo, node: options.node, timeoutMs: 240_000 });
  if (!status.origin) throw new Error("The team's service started without an address. Check its log and try again.");
  const session = await serviceRequest<{ certificate?: string }>('/session');
  if (!session.certificate) throw new Error("The team's service didn't report its certificate.");
  return { origin: status.origin, certificate: session.certificate };
}
