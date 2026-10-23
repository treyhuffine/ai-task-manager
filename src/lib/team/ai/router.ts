import { closeExecutionChat } from '@/lib/sessions/close-chat';
/**
 * Team AI's procedures (docs/homes-spec.md §9.9, P8.4-P8.5): its settings,
 * which every member can see and only the owner changes, and the team's
 * shared chats with it, which every member reads and writes as themselves.
 */

import { z } from 'zod/v4';
import { TRPCError } from '@trpc/server';
import * as q from '@/lib/db/queries';
import { memberProcedure, teamCapabilityProcedure, router } from '@/lib/trpc/init';
import type { ChatEventRecord, TeamChatTurnRecord } from '@/db/types';
import { sendToTeamAi, stopTeamAiWork, TEAM_CHAT_MESSAGE_MAX } from './chat';
import { configureTeamAi, forgetTeamAiKey, setTeamAiEnabled, teamAiStatus } from './settings';
import { legacyTeamEventDTO, LEGACY_TEAM_EVENT_SOURCES } from '@/lib/team/chat-event-view';
import { KNOWN_HARNESS_IDS } from '@/lib/harness/registry';
import { addMainChat } from '@/lib/sessions/main-chat';

import { retireChatForHome } from '@/lib/sessions/home-policy';
import { executionRequestKey } from '@/lib/home/execution-request';
import { authorizeTeamExecution } from '@/lib/home/execution-authority';
import { bindTeamChatAgent } from './native-turn';
import { teamChatAvailability } from './native-turn';

function me(ctx: { key: { memberId?: string | null } | null }) {
  const member = ctx.key?.memberId ? q.getMember(ctx.key.memberId) : null;
  if (!member || member.status !== 'active') throw new TRPCError({ code: 'UNAUTHORIZED' });
  return member;
}

function chatOr404(chatId: string) {
  authorizeTeamExecution(executionRequestKey(), { chatId, operation: 'read' });
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

/** What a member's screen shows of an event: never the provider's raw record. */
function eventView(event: ChatEventRecord & { cursor: number }, names: Map<string, string>) {
  const input = event.toolInput == null ? null : JSON.stringify(event.toolInput);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Shared transcripts never return provider payloads or their host metadata.
  const { raw, rawSubtype, rawModel, rawUsage, ...shared } = legacyTeamEventDTO(event)!;
  return {
    ...shared,
    id: event.id,
    cursor: event.cursor,
    role: event.role,
    source: event.source,
    content: event.content,
    toolName: event.toolName,
    toolInput: input && input.length > TOOL_INPUT_MAX ? `${input.slice(0, TOOL_INPUT_MAX)}…` : input,
    toolInputValue: input && input.length > TOOL_INPUT_MAX ? { preview: `${input.slice(0, TOOL_INPUT_MAX)}…` } : event.toolInput,
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
  /** Navigation needs saved configuration, never live harness discovery. */
  configuration: memberProcedure.query(() => {
    const settings = q.getTeamAiSettings();
    return { enabled: Boolean(settings?.enabled), mainChatId: settings?.mainChatSessionId ?? null };
  }),
  /** Whether Team AI is on, and why it might not be ready. Never the key. */
  status: memberProcedure.query(() => teamAiStatus()),
  chatStatus: memberProcedure.input(z.object({ chatId: z.string().min(1) }).strict()).query(({ input }) => {
    chatOr404(input.chatId);
    return teamChatAvailability(input.chatId);
  }),
  turnsForMessages: memberProcedure.input(z.object({ chatId: z.string().min(1), messageIds: z.array(z.string().min(1)).max(200) }).strict()).query(({ input }) => {
    chatOr404(input.chatId);
    return q.teamChatTurnsForMessages(input.chatId, input.messageIds).map(({ id, messageEventId, memberId, status, error }) => ({ id, messageEventId, memberId, status, error }));
  }),
  configure: teamCapabilityProcedure('manageSignIns')
    .input(z.object({
      model: z.string().max(160).nullable().optional(),
      harness: z.enum(KNOWN_HARNESS_IDS).optional(),
    }).strict())
    .mutation(async ({ ctx, input }) => {
      await configureTeamAi(me(ctx).id, input);
      return teamAiStatus();
    }),
  refreshAuth: teamCapabilityProcedure('manageSignIns').mutation(() => teamAiStatus({ freshAuth: true })),
  setEnabled: teamCapabilityProcedure('manageSignIns').input(z.object({ enabled: z.boolean() }).strict()).mutation(async ({ ctx, input }) => {
    const owner = me(ctx);
    await setTeamAiEnabled(owner.id, input.enabled);
    if (!input.enabled) {
      try { await stopTeamAiWork({}, 'Team AI was turned off.'); }
      catch (error) { return { ...await teamAiStatus(), reason: `AI is off, but some work could not stop. ${error instanceof Error ? error.message : String(error)}` }; }
    }
    return teamAiStatus();
  }),
  forgetKey: teamCapabilityProcedure('manageSignIns').mutation(async ({ ctx }) => {
    await forgetTeamAiKey(me(ctx).id);
    return teamAiStatus();
  }),

  chats: router({
    bind: memberProcedure.input(z.object({ chatId: z.string().min(1), workspaceId: z.string().min(1) }).strict()).mutation(({ ctx, input }) => bindTeamChatAgent(input.chatId, ctx.key!, input.workspaceId)),
    list: memberProcedure.input(z.object({ includeArchived: z.boolean().optional() }).strict().optional()).query(({ input }) => {
      const mainId = q.getTeamAiSettings()?.mainChatSessionId ?? null;
      return q.listTeamChats(input).map((chat) => {
        const turns = q.listTeamChatTurns(chat.id, { limit: 50 });
        return {
          id: chat.id,
          label: chat.label,
          workspaceId: chat.workspaceId,
          archived: chat.status === 'archived',
          main: chat.id === mainId,
          lastActivityAt: chat.lastActivityAt,
          working: turns.some((t) => t.status === 'queued' || t.status === 'running'),
        };
      });
    }),
    create: teamCapabilityProcedure('runTeamAgent').input(z.object({ label: z.string().min(1).max(120), workspaceId: z.string().min(1).optional() }).strict()).mutation(async ({ ctx, input }) => {
      me(ctx);
      const agents = q.listWorkspaces({ status: 'active' });
      const workspaceId = input.workspaceId ?? (agents.length === 1 ? agents[0].id : null);
      if (!workspaceId) throw new q.TeamError('not_allowed', 'Choose an enabled team agent in Agents to start a new chat.');
      const chat = await addMainChat(workspaceId);
      const renamed = q.updateChatSession(chat.id, { label: input.label.trim() })!;
      return { id: renamed.id, label: renamed.label };
    }),
    rename: teamCapabilityProcedure('editContent').input(z.object({ id: z.string().min(1), label: z.string().min(1).max(120) }).strict()).mutation(({ ctx, input }) => {
      me(ctx);
      chatOr404(input.id);
      q.updateChatSession(input.id, { label: input.label.trim() });
      return { ok: true as const };
    }),
    archive: teamCapabilityProcedure('archiveChat').input(z.object({ id: z.string().min(1) }).strict()).mutation(async ({ ctx, input }) => {
      me(ctx);
      const chat = chatOr404(input.id);
      if (chat.executionId) {
        const outcome = await closeExecutionChat(chat.id);
        if ('error' in outcome) throw new TRPCError({ code: outcome.status === 409 ? 'CONFLICT' : 'BAD_REQUEST', message: outcome.message });
      }
      else {
        await retireChatForHome(chat.id);
      }
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
    .input(z.object({ chatId: z.string().min(1), after: z.number().int().nonnegative().optional(), before: z.number().int().positive().optional(), limit: z.number().int().min(1).max(500).optional(), revisions: z.array(z.object({ id: z.string().min(1), revision: z.number().int().nonnegative() }).strict()).max(200).optional() }).strict().refine(input => input.after === undefined || input.before === undefined, 'Choose before or after, not both.'))
    .query(({ ctx, input }) => {
      me(ctx);
      const chat = chatOr404(input.chatId);
      const page = input.after === undefined
        ? q.listTeamChatEventsLatest(chat.id, input.limit ?? 200, input.before)
        : q.listTeamChatEventsAfter(chat.id, input.after, input.limit ?? 200);
      const names = memberNames();
      return {
        chat: { id: chat.id, label: chat.label, main: q.getTeamAiSettings()?.mainChatSessionId === chat.id, archived: chat.status === 'archived' },
        events: page.events.filter((event) => LEGACY_TEAM_EVENT_SOURCES.has(event.source)).map((event) => eventView(event, names)),
        updates: q.revisedTeamChatEvents(chat.id, input.revisions ?? []).filter(event => LEGACY_TEAM_EVENT_SOURCES.has(event.source)).map(event => eventView(event, names)),
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

  send: teamCapabilityProcedure('runTeamAgent')
    .input(z.object({ chatId: z.string().min(1), authorMemberId: z.string().min(1).optional(), clientSendId: z.string().min(8).max(100), text: z.string().min(1).max(TEAM_CHAT_MESSAGE_MAX) }).strict())
    .mutation(async ({ ctx, input }) => {
      const member = me(ctx);
      if (input.authorMemberId && input.authorMemberId !== member.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'The sign-in changed. This draft is kept for its original author.' });
      const sent = await sendToTeamAi({ ...input, memberId: member.id, requestingApiKeyId: ctx.key?.apiKeyId, senderSessionId: ctx.key?.sessionChatId ?? undefined });
      return { turnId: sent.turn.id, messageId: sent.message.id, created: sent.created, status: sent.turn.status };
    }),

  /** Any active member can stop running work or cancel a queued message. */
  stop: memberProcedure.input(z.object({ turnId: z.string().min(1) }).strict()).mutation(async ({ ctx, input }) => {
    const member = me(ctx);
    const turn = q.getTeamChatTurn(input.turnId);
    if (!turn) throw new TRPCError({ code: 'NOT_FOUND', message: 'That turn is gone.' });
    authorizeTeamExecution(ctx.key, { chatId: turn.chatSessionId, turnId: turn.id, operation: turn.status === 'queued' ? 'cancelQueued' : 'stop' });
    await stopTeamAiWork({ turnId: turn.id }, `Stopped by ${member.name}.`);
    return { ok: true as const };
  }),
});
