/**
 * A team member's own procedures (docs/homes-spec.md §3.2, §9.1): who's in
 * the team, signing in on another device, and for the owner, people,
 * invitations, the team's name and the address invitations name.
 *
 * Shared work itself (tasks, notes, Areas, history, search) goes through
 * the ordinary procedures, which act as the member in a team
 * (src/lib/team/shared-work.ts).
 */

import { z } from 'zod/v4';
import { TRPCError } from '@trpc/server';
import { baseUrlSnapshot } from '@/lib/auth/base-url-snapshot';
import { openAndSaveBeamdBaseUrl } from '@/lib/auth/beamd-base-url';
import { clearRemoteBaseUrl, setRemoteBaseUrl, setRunningPort } from '@/lib/auth/bootstrap';
import { readLiveServerRuntime } from '@/lib/server-runtime/record';
import * as q from '@/lib/db/queries';
import { memberProcedure, ownerProcedure, router } from '@/lib/trpc/init';
import { teamLink, type TeamLinkKind } from './links';
import { teamSummary } from './summary';
import { teamLinkAddress, verifyTeamAddress } from './address';

const nameInput = z.object({ name: z.string().min(1).max(q.MEMBER_NAME_MAX) }).strict();
const idInput = z.object({ id: z.string().min(1) }).strict();

function me(ctx: { key: { memberId?: string | null } | null }) {
  const member = ctx.key?.memberId ? q.getMember(ctx.key.memberId) : null;
  if (!member || member.status !== 'active') throw new TRPCError({ code: 'UNAUTHORIZED' });
  return member;
}

function memberView(member: { id: string; name: string; role: 'owner' | 'member' }) {
  return { id: member.id, name: member.name, role: member.role };
}

/** A grant's link at the address people reach the team at. */
async function linkFor(kind: TeamLinkKind, secret: string, origin: string | null) {
  const { base, reachable } = await teamLinkAddress(origin);
  return { link: teamLink(base, kind, secret), reachable, base };
}

function requestOrigin(request: Request): string | null {
  const origin = request.headers.get('origin');
  if (origin) return origin;
  try {
    const url = new URL(request.url);
    const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    return host ? `${proto || url.protocol.replace(':', '')}://${host}` : url.origin;
  } catch {
    return null;
  }
}

export const teamRouter = router({
  /** The team and who's signed in. */
  me: memberProcedure.query(({ ctx }) => {
    const member = me(ctx);
    return { team: teamSummary(), member: memberView(member) };
  }),
  /** Everyone in the team, for assigning work and naming who changed it. */
  members: memberProcedure.query(() => q.listMembers({ includeRemoved: true }).map((m) => ({ ...memberView(m), active: m.status === 'active' }))),
  renameMe: memberProcedure.input(nameInput).mutation(({ ctx, input }) => memberView(q.renameMember(me(ctx).id, input.name))),

  /** This member's sign-ins, and a link to sign in on another device. */
  signIns: router({
    list: memberProcedure.query(({ ctx }) =>
      q.listMemberSignIns(me(ctx).id).map((s) => ({ ...s, current: s.keyId === ctx.key!.apiKeyId })),
    ),
    create: memberProcedure.mutation(async ({ ctx }) => {
      const member = me(ctx);
      const { grant, secret } = q.createTeamGrant({ kind: 'sign_in', memberId: member.id, createdByMemberId: member.id });
      return { ...await linkFor('sign-in', secret, requestOrigin(ctx.request)), expiresAt: grant.expiresAt };
    }),
    revoke: memberProcedure.input(z.object({ keyId: z.string().min(1) }).strict()).mutation(({ ctx, input }) => {
      q.revokeMemberSignIn(me(ctx).id, input.keyId);
      return { ok: true as const };
    }),
    /** Sign out here: this client's key stops working. */
    signOut: memberProcedure.mutation(({ ctx }) => {
      q.revokeMemberSignIn(me(ctx).id, ctx.key!.apiKeyId);
      return { ok: true as const };
    }),
  }),

  // ─── The owner's ─────────────────────────────────────────────
  rename: ownerProcedure.input(nameInput).mutation(({ input }) => {
    q.renameTeam(input.name);
    return teamSummary();
  }),
  removeMember: ownerProcedure.input(idInput).mutation(({ input }) => memberView(q.removeMember(input.id))),
  invitations: router({
    list: ownerProcedure.query(() => q.listTeamInvitations()),
    create: ownerProcedure.mutation(async ({ ctx }) => {
      const owner = me(ctx);
      const { grant, secret } = q.createTeamGrant({ kind: 'invite', role: 'member', createdByMemberId: owner.id });
      return { id: grant.id, ...await linkFor('invite', secret, requestOrigin(ctx.request)), expiresAt: grant.expiresAt };
    }),
    revoke: ownerProcedure.input(idInput).mutation(({ input }) => {
      q.revokeTeamGrant(input.id);
      return { ok: true as const };
    }),
  }),
  /**
   * Where people reach the team. The same remote-address setup a personal Ri
   * uses: an address the owner already has, or a Beamd tunnel.
   */
  address: router({
    get: ownerProcedure.query(() => {
      const snapshot = baseUrlSnapshot();
      return { address: snapshot.tunnel, local: snapshot.local, autoTunnel: snapshot.autoTunnel };
    }),
    set: ownerProcedure.input(z.object({ address: z.string().min(1).max(2048) }).strict()).mutation(async ({ input }) => {
      try {
        return { address: setRemoteBaseUrl(await verifyTeamAddress(input.address)) };
      } catch (err) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: err instanceof Error ? err.message : 'That address is not valid.' });
      }
    }),
    clear: ownerProcedure.mutation(() => {
      clearRemoteBaseUrl();
      return { address: null };
    }),
    openBeamd: ownerProcedure.mutation(async ({ ctx }) => {
      const running = readLiveServerRuntime();
      const port = running?.privateUpstreams?.next
        ? Number(new URL(running.privateUpstreams.next).port)
        : Number(new URL(ctx.request.url).port) || 0;
      if (!port) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: "Ri couldn't tell which port the team is on." });
      setRunningPort(port);
      try {
        const opened = await openAndSaveBeamdBaseUrl(port, { verifyUrl: verifyTeamAddress });
        return { address: opened.url };
      } catch (err) {
        if (err instanceof Error) throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
        throw err;
      }
    }),
  }),
});
