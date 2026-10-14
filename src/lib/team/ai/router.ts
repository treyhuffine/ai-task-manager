/**
 * Team AI's procedures (docs/homes-spec.md §9.9, P8.4-P8.5): its settings,
 * which every member can see and only the owner changes, and the team's
 * shared chats with it, which every member reads and writes as themselves.
 */

import { z } from 'zod/v4';
import { TRPCError } from '@trpc/server';
import * as q from '@/lib/db/queries';
import { memberProcedure, ownerProcedure, router } from '@/lib/trpc/init';
import type { ChatEventRecord, TeamChatTurnRecord } from '@/db/types';
import { sendToTeamAi, stopTeamAiWork, TEAM_CHAT_MESSAGE_MAX } from './chat';
import { configureTeamAi, forgetTeamAiKey, setTeamAiEnabled, teamAiStatus } from './settings';

function me(ctx: { key: { memberId?: string | null } | null }) {
  const member = ctx.key?.memberId ? q.getMember(ctx.key.memberId) : null;
  if (!member || member.status !== 'active') throw new TRPCError({ code: 'UNAUTHORIZED' });
  return member;
}

function chatOr404(chatId: string) {
  const chat = q.getTeamChat(chatId);
  if (!chat) throw new TRPCError({ code: 'NOT_FOUND', message: 'That chat is gone.' });
  return chat;
}

const TOOL_INPUT_MAX = 2_000;

/**
 * What a member's transcript shows: messages, Team AI's answers, the tools it
 * used and its errors. Not the runtime's own records (start-up, lifecycle,
 * results), which carry the host's details and mean nothing to a member.
 */
const MEMBER_VISIBLE_SOURCES = new Set(['user', 'agent', 'tool_call', 'tool_result', 'error']);

/** What a member's screen shows of an event: never the provider's raw record. */
function eventView(event: ChatEventRecord & { cursor: number }, names: Map<string, string>) {
  const input = event.toolInput == null ? null : JSON.stringify(event.toolInput);
  return {
    id: event.id,
    cursor: event.cursor,
    role: event.role,
    source: event.source,
    content: event.content,
    toolName: event.toolName,
    toolInput: input && input.length > TOOL_INPUT_MAX ? `${input.slice(0, TOOL_INPUT_MAX)}…` : input,
    toolIsError: event.toolIsError,
    createdAt: event.createdAt,
    author: event.authorMemberId ? { id: event.authorMemberId, name: names.get(event.authorMemberId) ?? 'Someone who left' } : null,
  };
}

function turnView(turn: TeamChatTurnRecord, names: Map<string, string>) {
  return {
    id: turn.id,
    seq: turn.seq,
    status: turn.status,
    member: { id: turn.memberId, name: names.get(turn.memberId) ?? 'Someone who left' },
    messageEventId: turn.messageEventId,
    error: turn.error,
    startedAt: turn.startedAt,
    finishedAt: turn.finishedAt,
  };
}

function memberNames() {
  return new Map(q.listMembers({ includeRemoved: true }).map((m) => [m.id, m.name]));
}

export const teamAiRouter = router({
  /** Whether Team AI is on, and why it might not be ready. Never the key. */
  status: memberProcedure.query(() => teamAiStatus()),
  configure: ownerProcedure
    .input(z.object({
      model: z.string().max(100).nullable().optional(),
    }).strict())
    .mutation(async ({ ctx, input }) => {
      await configureTeamAi(me(ctx).id, input);
      return teamAiStatus();
    }),
  refreshAuth: ownerProcedure.mutation(() => teamAiStatus({ freshAuth: true })),
  setEnabled: ownerProcedure.input(z.object({ enabled: z.boolean() }).strict()).mutation(async ({ ctx, input }) => {
    const owner = me(ctx);
    await setTeamAiEnabled(owner.id, input.enabled);
    if (!input.enabled) await stopTeamAiWork({}, 'Team AI was turned off.');
    return teamAiStatus();
  }),
  forgetKey: ownerProcedure.mutation(async ({ ctx }) => {
    forgetTeamAiKey(me(ctx).id);
    return teamAiStatus();
  }),

  chats: router({
    list: memberProcedure.query(() => {
      const mainId = q.getTeamAiSettings()?.mainChatSessionId ?? null;
      return q.listTeamChats().map((chat) => {
        const turns = q.listTeamChatTurns(chat.id, { limit: 50 });
        return {
          id: chat.id,
          label: chat.label,
          main: chat.id === mainId,
          lastActivityAt: chat.lastActivityAt,
          working: turns.some((t) => t.status === 'queued' || t.status === 'running'),
        };
      });
    }),
    create: memberProcedure.input(z.object({ label: z.string().min(1).max(120) }).strict()).mutation(({ ctx, input }) => {
      me(ctx);
      if (!q.getTeamAiSettings()?.enabled) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: "Team AI is off. The team's owner can turn it on in Settings." });
      const chat = q.createTeamChat(input.label.trim());
      return { id: chat.id, label: chat.label };
    }),
    rename: memberProcedure.input(z.object({ id: z.string().min(1), label: z.string().min(1).max(120) }).strict()).mutation(({ ctx, input }) => {
      me(ctx);
      chatOr404(input.id);
      q.updateChatSession(input.id, { label: input.label.trim() });
      return { ok: true as const };
    }),
    archive: memberProcedure.input(z.object({ id: z.string().min(1) }).strict()).mutation(({ ctx, input }) => {
      me(ctx);
      chatOr404(input.id);
      if (q.getTeamAiSettings()?.mainChatSessionId === input.id) throw new TRPCError({ code: 'BAD_REQUEST', message: "The team's main chat stays." });
      q.updateChatSession(input.id, { status: 'archived', archivedAt: new Date().toISOString() });
      return { ok: true as const };
    }),
  }),

  /** The team's chats by name or by what was said in them, bounded. */
  searchChats: memberProcedure.input(z.object({ query: z.string().min(1).max(200) }).strict()).query(({ ctx, input }) => {
    me(ctx);
    return q.searchChatSessions({ query: input.query, teamChats: true, limit: 10 }).map((hit) => ({
      id: hit.id,
      label: hit.label,
      archived: hit.status === 'archived',
      snippet: hit.snippet === null ? null : hit.snippet.replace(/[\u0002\u0003]|<\/?mark>/g, ''),
    }));
  }),

  /**
   * A chat's events after a cursor, or its latest page with none, and the
   * state of its turns. A reader that reconnects passes its cursor and gets
   * exactly what it missed.
   */
  events: memberProcedure
    .input(z.object({ chatId: z.string().min(1), after: z.number().int().nonnegative().optional(), before: z.number().int().positive().optional(), limit: z.number().int().min(1).max(500).optional() }).strict().refine(input => input.after === undefined || input.before === undefined, 'Choose before or after, not both.'))
    .query(({ ctx, input }) => {
      me(ctx);
      const chat = chatOr404(input.chatId);
      const page = input.after === undefined
        ? q.listTeamChatEventsLatest(chat.id, input.limit ?? 200, input.before)
        : q.listTeamChatEventsAfter(chat.id, input.after, input.limit ?? 200);
      const names = memberNames();
      return {
        chat: { id: chat.id, label: chat.label, main: q.getTeamAiSettings()?.mainChatSessionId === chat.id, archived: chat.status === 'archived' },
        events: page.events.filter((event) => MEMBER_VISIBLE_SOURCES.has(event.source)).map((event) => eventView(event, names)),
        // Past everything read, shown or not, so nothing is read twice.
        cursor: page.cursor,
        oldestCursor: 'oldestCursor' in page ? page.oldestCursor as number | null : null,
        hasOlder: 'hasOlder' in page && page.hasOlder === true,
        turns: [...new Map([
          ...q.listTeamChatTurns(chat.id, { limit: 200 }),
          ...q.teamChatTurnsForMessages(chat.id, page.events.map(event => event.id)),
        ].map(turn => [turn.id, turn])).values()].map((turn) => turnView(turn, names)),
      };
    }),

  send: memberProcedure
    .input(z.object({ chatId: z.string().min(1), clientSendId: z.string().min(8).max(100), text: z.string().min(1).max(TEAM_CHAT_MESSAGE_MAX) }).strict())
    .mutation(async ({ ctx, input }) => {
      const member = me(ctx);
      const sent = await sendToTeamAi({ ...input, memberId: member.id });
      return { turnId: sent.turn.id, messageId: sent.message.id, created: sent.created, status: sent.turn.status };
    }),

  /** Stop a turn: the member who sent it, or the team's owner. */
  stop: memberProcedure.input(z.object({ turnId: z.string().min(1) }).strict()).mutation(async ({ ctx, input }) => {
    const member = me(ctx);
    const turn = q.getTeamChatTurn(input.turnId);
    if (!turn) throw new TRPCError({ code: 'NOT_FOUND', message: 'That turn is gone.' });
    if (turn.memberId !== member.id && member.role !== 'owner') throw new TRPCError({ code: 'FORBIDDEN', message: "Only who sent it, or the team's owner, can stop it." });
    if (turn.status === 'queued') q.finishTeamChatTurn(turn.id, 'cancelled', `Stopped by ${member.name}.`);
    else if (turn.status === 'running') await stopTeamAiWork({ turnId: turn.id }, `Stopped by ${member.name}.`);
    return { ok: true as const };
  }),
});
