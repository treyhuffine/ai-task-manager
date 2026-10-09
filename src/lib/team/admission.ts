/**
 * Getting into a team (docs/homes-spec.md §3.1, §9.1, P6.1): the routes a
 * grant opens on its own, and the host's trusted local creation.
 *
 * - Anyone with an invitation sees the team's name and joins as a new
 *   member. Anyone with a sign-in link signs that member in here. Anyone
 *   with an operator's setup link names the team and becomes its owner,
 *   once. Each leaves a member signed in on this client, with a key that is
 *   theirs alone and never a personal key.
 * - The host's own key makes the first owner for the desktop's Create a
 *   team, retry-safe by its creation id, and makes setup links for a team
 *   provisioned on a server.
 *
 * A bare team address proves nothing: without a grant or a member's key,
 * the team says only that it is a team.
 */

import { z } from 'zod/v4';
import { DEVICE_KINDS } from '@/lib/db/schema';
import * as q from '@/lib/db/queries';
import type { DeviceKind } from '@/db/types';
import { teamSummary, type TeamSummary } from './summary';
import { teamLink } from './links';
import { teamLinkAddress } from './address';

const secret = z.string().trim().min(8).max(200);
const deviceInput = z
  .object({
    kind: z.enum(DEVICE_KINDS).optional(),
    name: z.string().trim().max(120).optional(),
  })
  .strict()
  .optional();

const attemptId = z.string().regex(/^[A-Za-z0-9_-]{32,80}$/).optional();
export const previewInput = z.object({ secret, kind: z.enum(['invite', 'sign-in', 'setup']), attemptId }).strict();
export const joinInput = z.object({ secret, name: z.string().max(200), device: deviceInput }).strict();
export const signInInput = z.object({ secret, device: deviceInput }).strict();
export const setupInput = z.object({ secret, attemptId, teamName: z.string().max(200), ownerName: z.string().max(200), device: deviceInput }).strict();
export const ownerInput = z
  .object({
    creationId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
    ownerName: z.string().max(200),
    teamName: z.string().max(200).optional(),
    device: deviceInput,
  })
  .strict();

type DeviceInput = z.infer<typeof deviceInput>;

/** What a client is, from what it said and its user agent. A label, never a credential. */
export function clientDevice(input: DeviceInput, userAgent: string | null): { name: string; kind: DeviceKind; platform: string | null } {
  const ua = userAgent ?? '';
  const platform = /iPhone/i.test(ua) ? 'iOS' : /iPad/i.test(ua) ? 'iPadOS' : /Android/i.test(ua) ? 'Android' : /Mac OS X|Macintosh/i.test(ua) ? 'macOS' : /Windows/i.test(ua) ? 'Windows' : /Linux/i.test(ua) ? 'Linux' : null;
  const kind: DeviceKind = input?.kind ?? (/iPhone|Android.+Mobile/i.test(ua) ? 'phone' : /iPad|Tablet/i.test(ua) ? 'tablet' : 'other');
  const fallback = /Electron/i.test(ua)
    ? 'Ri desktop'
    : platform === 'iOS' ? 'iPhone' : platform === 'iPadOS' ? 'iPad' : platform === 'Android' ? 'Android phone' : platform === 'macOS' ? 'Mac browser' : 'Browser';
  return { name: input?.name?.trim() || fallback, kind, platform };
}

export interface Admitted {
  token: string;
  member: { id: string; name: string; role: 'owner' | 'member' };
  team: TeamSummary;
}

function admitted(signIn: q.TeamSignIn): Admitted {
  return {
    token: signIn.token.plaintext,
    member: { id: signIn.member.id, name: signIn.member.name, role: signIn.member.role },
    team: teamSummary(),
  };
}

const KIND: Record<z.infer<typeof previewInput>['kind'], 'invite' | 'sign_in' | 'setup'> = {
  invite: 'invite',
  'sign-in': 'sign_in',
  setup: 'setup',
};

export interface GrantPreview {
  grantId?: string;
  kind: 'team';
  state: q.TeamGrantState;
  team: { id: string; name: string } | null;
  /** For a sign-in link: whose it is. */
  member: { name: string } | null;
  expiresAt: string | null;
}

/**
 * What a link opens, before anyone uses it. The team's name only for a grant
 * that exists, so a guess learns nothing.
 */
export function previewGrant(input: z.infer<typeof previewInput>): GrantPreview {
  const { grant, state } = q.inspectTeamGrant(input.secret, KIND[input.kind]);
  if (!grant) return { kind: 'team', state, team: null, member: null, expiresAt: null };
  const summary = teamSummary();
  const member = grant.kind === 'sign_in' && grant.memberId ? q.getMember(grant.memberId) : null;
  return {
    kind: 'team',
    grantId: grant.id,
    state: input.kind === 'setup' && q.canRetryTeamSetup(grant, input.attemptId) ? 'valid' : state,
    team: { id: summary.id, name: summary.name },
    member: member ? { name: member.name } : null,
    expiresAt: grant.expiresAt,
  };
}

export function join(input: z.infer<typeof joinInput>, userAgent: string | null): Admitted {
  return admitted(q.redeemTeamInvite({ secret: input.secret, name: input.name, device: clientDevice(input.device, userAgent) }));
}

export function signIn(input: z.infer<typeof signInInput>, userAgent: string | null): Admitted {
  return admitted(q.redeemTeamSignIn({ secret: input.secret, device: clientDevice(input.device, userAgent) }));
}

export function finishSetup(input: z.infer<typeof setupInput>, userAgent: string | null): Admitted {
  return admitted(
    q.redeemTeamSetup({
      secret: input.secret,
      attemptId: input.attemptId,
      teamName: input.teamName,
      ownerName: input.ownerName,
      device: clientDevice(input.device, userAgent),
    }),
  );
}

/** The trusted local creation flow's owner. Retry-safe by creation id. */
export function createOwner(input: z.infer<typeof ownerInput>, userAgent: string | null): Admitted & { created: boolean } {
  const result = q.createTeamOwner({
    creationId: input.creationId,
    name: input.ownerName,
    device: clientDevice({ kind: input.device?.kind ?? 'computer', name: input.device?.name }, userAgent),
  });
  if (input.teamName?.trim()) q.renameTeam(input.teamName);
  return { ...admitted(result), created: result.created };
}

/** A setup link for a team provisioned on a server, for its operator to open. */
export async function createSetupLink(): Promise<{ link: string; expiresAt: string; reachable: boolean }> {
  const { grant, secret: value } = q.createTeamGrant({ kind: 'setup', createdByMemberId: null });
  const { base, reachable } = await teamLinkAddress();
  return { link: teamLink(base, 'setup', value), expiresAt: grant.expiresAt, reachable };
}

/** What a bare team address says without a grant or a key. */
export function publicInfo(): { kind: 'team'; ready: boolean } {
  return { kind: 'team', ready: q.teamHasOwner() };
}
