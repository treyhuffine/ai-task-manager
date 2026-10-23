/**
 * A team member's own procedures (docs/homes-spec.md §3.2, §9.1): who's in
 * the team, signing in on another device, and for the owner, people,
 * invitations, the team's name and the address invitations name.
 *
 * Shared work itself (tasks, notes, Areas, history, search) goes through
 * the ordinary procedures, which act as the member in a team
 * (src/lib/team/shared-work.ts).
 */

/**
 * A team member's own procedures (docs/homes-spec.md §3.2, §9.1): who's in
 * the team, signing in on another device, and for the owner, people,
 * invitations, the team's name and the address invitations name.
 *
 * Shared work itself (tasks, notes, Areas, history, search) goes through
 * the ordinary procedures, which act as the member in a team
 * (src/lib/team/shared-work.ts).
 */
import { stopTeamAiWork } from './ai/chat';
import { z } from 'zod/v4';
import { TRPCError } from '@trpc/server';
import { setRunningPort } from '@/lib/auth/bootstrap';
import { writeAuthConfig } from '@/lib/auth/config-file';
import { readLiveServerRuntime } from '@/lib/server-runtime/record';
import * as q from '@/lib/db/queries';
import { memberProcedure, ownerProcedure, teamCapabilityProcedure, router } from '@/lib/trpc/init';
import { teamLink } from './links';
import { teamSummary } from './summary';
import { teamAddressSettings, teamLinkAddress, verifyTeamAddress, openTeamBeamdAddress, saveTeamAddressPrefix, isLoopbackTeamAddress, normalizeTeamAddress } from './address';
import { TEAM_MCP_PATH } from './credential';
import { teamAiRouter } from './ai/router';
import { z as toolSchema } from 'zod';
import { TEAM_TOOLS, runTeamTool, type TeamToolResult } from './mcp/tools';
import { teamWriteSource } from './shared-work';
import type { TRPCContext } from '@/lib/trpc/init';
import { publishTaskResult } from './published-results';
import { publishTaskResultSchema } from '@/lib/trpc/schemas';

const nativeInput = z.object({ action: z.string().min(1).max(100), input: z.record(z.string(), z.unknown()) }).strict();

/** The same content operations as MCP, under the existing personal Home sign-in. */
async function nativeContent(ctx: TRPCContext, input: z.infer<typeof nativeInput>, kind: 'read' | 'write'): Promise<TeamToolResult> {
  teamWriteSource(ctx.key, 'ai');
  const member = me(ctx);
  const tool = TEAM_TOOLS.find((t) => t.name === input.action && t.kind === kind);
  if (!tool) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown content operation.' });
  const parsed = toolSchema.object(tool.shape).strict().safeParse(input.input);
  if (!parsed.success) throw new TRPCError({ code: 'BAD_REQUEST', message: parsed.error.message });
  return runTeamTool(tool, { member, apiKeyId: ctx.key!.apiKeyId, base: new URL(ctx.request.url).origin }, parsed.data);
}

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

/** Check reachability before creating a grant when the browser needs a remote link. */
async function createMemberLink(kind: 'invite' | 'sign-in', memberId: string, origin: string | null, remoteOnly = false) {
  const { base, reachable } = await teamLinkAddress(origin);
  if (remoteOnly && !reachable) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Set up a reachable team address before making this link.' });
  const { grant, secret } = kind === 'invite'
    ? q.createTeamGrant({ kind: 'invite', role: 'member', createdByMemberId: memberId })
    : q.createTeamGrant({ kind: 'sign_in', memberId, createdByMemberId: memberId });
  return { id: grant.id, link: teamLink(base, kind, secret), reachable, base, expiresAt: grant.expiresAt };
}

async function openBeamdAddress(request: Request, name?: string) {
  const running = readLiveServerRuntime();
  const port = running?.privateUpstreams?.next
    ? Number(new URL(running.privateUpstreams.next).port)
    : Number(new URL(request.url).port) || 0;
  if (!port) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: "Ri couldn't tell which port the team is on." });
  setRunningPort(port);
  try {
    return await openTeamBeamdAddress(port, name);
  } catch (err) {
    if (err instanceof Error) throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
    throw err;
  }
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
  referenceChanges: memberProcedure.input(z.object({
    tasks: z.array(z.object({ id: z.string().min(1), cursor: z.string().max(64).nullable().optional() }).strict()).max(200),
    notes: z.array(z.object({ id: z.string().min(1), cursor: z.string().max(64).nullable().optional() }).strict()).max(200),
  }).strict()).mutation(({ input }) => q.teamReferenceChanges(input)),
  nativePublish: memberProcedure.input(publishTaskResultSchema).mutation(({ ctx, input }) => {
    teamWriteSource(ctx.key, 'ai');
    return publishTaskResult({ ...input, memberId: me(ctx).id, source: 'ai' });
  }),
  nativeRead: memberProcedure.input(nativeInput).query(({ ctx, input }) => nativeContent(ctx, input, 'read')),
  nativeWrite: memberProcedure.input(nativeInput).mutation(({ ctx, input }) => nativeContent(ctx, input, 'write')),
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
    create: memberProcedure.mutation(({ ctx }) => createMemberLink('sign-in', me(ctx).id, requestOrigin(ctx.request))),
    createRemote: memberProcedure.mutation(({ ctx }) => createMemberLink('sign-in', me(ctx).id, requestOrigin(ctx.request), true)),
    revoke: memberProcedure.input(z.object({ keyId: z.string().min(1) }).strict()).mutation(async ({ ctx, input }) => {
      q.revokeMemberSignIn(me(ctx).id, input.keyId);
      await stopTeamAiWork({ apiKeyId: input.keyId }, 'The requesting sign-in was revoked.');
      return { ok: true as const };
    }),
    /** Sign out here: this client's key stops working. */
    signOut: memberProcedure.mutation(async ({ ctx }) => {
      q.revokeMemberSignIn(me(ctx).id, ctx.key!.apiKeyId);
      await stopTeamAiWork({ apiKeyId: ctx.key!.apiKeyId }, 'The requesting sign-in was revoked.');
      return { ok: true as const };
    }),
  }),

  /**
   * This member's own AI assistants (docs/homes-spec.md §9.8): each a key
   * that reaches only the team's MCP and acts as this member's agent. The
   * key is shown once, when it's made.
   */
  aiClients: router({
    list: memberProcedure.query(({ ctx }) => q.listMemberAiClients(me(ctx).id)),
    create: memberProcedure.input(z.object({ name: z.string().min(1).max(q.AI_CLIENT_NAME_MAX) }).strict()).mutation(async ({ ctx, input }) => {
      const member = me(ctx);
      const { client, token } = q.createMemberAiClient(member.id, input.name);
      const { base, reachable } = await teamLinkAddress(requestOrigin(ctx.request));
      return { client, token: token.plaintext, mcpUrl: `${base}${TEAM_MCP_PATH}`, reachable };
    }),
    revoke: memberProcedure.input(z.object({ keyId: z.string().min(1) }).strict()).mutation(async ({ ctx, input }) => {
      q.revokeMemberAiClient(me(ctx).id, input.keyId);
      return { ok: true as const };
    }),
  }),

  /** Team AI: its settings, and the team's shared chats with it (§9.9). */
  ai: teamAiRouter,
  agentActivity: teamCapabilityProcedure('read').input(z.object({ workspaceId: z.string().min(1) }).strict()).query(({ input }) => {
    if (!q.getWorkspace(input.workspaceId)) throw new q.TeamError('not_found', 'That agent is gone.');
    const names = new Map(q.listMembers({ includeRemoved: true }).map(member => [member.id, member.name]));
    return q.listTeamActivity(input.workspaceId).map(({ apiKeyId: _apiKeyId, ...activity }) => ({ ...activity, memberName: names.get(activity.memberId) ?? 'Someone who left' }));
  }),

  // ─── The owner's ─────────────────────────────────────────────
  rename: ownerProcedure.input(nameInput).mutation(({ input }) => {
    q.renameTeam(input.name);
    return teamSummary();
  }),
  removeMember: ownerProcedure.input(idInput).mutation(async ({ input }) => {
    const removed = q.removeMember(input.id);
    // Their waiting Team AI turns are cancelled and a running one stopped (§9.9).
    const { stopTeamAiWork } = await import('./ai/chat');
    await stopTeamAiWork({ memberId: removed.id }, 'The member who sent this left the team.');
    return memberView(removed);
  }),
  invitations: router({
    list: ownerProcedure.query(() => q.listTeamInvitations()),
    create: ownerProcedure.mutation(({ ctx }) => createMemberLink('invite', me(ctx).id, requestOrigin(ctx.request))),
    createRemote: ownerProcedure.mutation(({ ctx }) => createMemberLink('invite', me(ctx).id, requestOrigin(ctx.request), true)),
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
    get: ownerProcedure.query(() => teamAddressSettings()),
    savePrefix: ownerProcedure.input(z.object({ name: z.string().min(1).max(63) }).strict()).mutation(({ input }) => {
      try {
        return saveTeamAddressPrefix(input.name);
      } catch (err) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: err instanceof Error ? err.message : 'That prefix is not valid.' });
      }
    }),
    set: ownerProcedure.input(z.object({ address: z.string().min(1).max(2048) }).strict()).mutation(async ({ input }) => {
      try {
        if (isLoopbackTeamAddress(normalizeTeamAddress(input.address))) throw new Error('Choose an address other devices can reach. A localhost address only works on the hosting computer.');
        const address = await verifyTeamAddress(input.address);
        writeAuthConfig({ tunnelUrl: address, autoTunnel: false });
        return { address };
      } catch (err) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: err instanceof Error ? err.message : 'That address is not valid.' });
      }
    }),
    clear: ownerProcedure.mutation(() => {
      writeAuthConfig({ tunnelUrl: null, autoTunnel: false });
      return { address: null };
    }),
    // Keep the original no-input endpoint usable by existing clients.
    openBeamd: ownerProcedure.mutation(({ ctx }) => openBeamdAddress(ctx.request)),
    configureBeamd: ownerProcedure.input(z.object({ name: z.string().min(1).max(63) }).strict())
      .mutation(({ ctx, input }) => openBeamdAddress(ctx.request, input.name)),
  }),
});
