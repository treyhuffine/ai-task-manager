/**
 * The team's shared chats with its AI (docs/homes-spec.md §9.9, P8.5).
 *
 * A member's message is accepted durably, with its author, and queued: one
 * turn runs at a time in each chat, in the order messages were accepted, each
 * as the member who sent it, with its own credential. A retried send finds
 * the message it already made. Before a turn starts, the member and Team AI
 * are checked again. Turning Team AI off, or removing a member, cancels their
 * queued turns and stops a running one. A turn that was running when the team
 * stopped is shown as interrupted, never run again by itself.
 *
 * Who's waiting on which chat is per process (processState): the team runs in
 * one server.
 */

import * as q from '@/lib/db/queries';
import { processState } from '@/lib/process-state';
import type { TeamChatTurnRecord } from '@/db/types';
import { runTeamTurn, type RunTeamTurnInput } from './runtime';
import { CREDENTIAL_REJECTED, recordTeamAiOutcome, teamAiStatus } from './settings';
import { teamAiAuthRevision } from './auth';

export const TEAM_CHAT_MESSAGE_MAX = 20_000;

interface ChatWork {
  turnId: string;
  controller: AbortController;
  done: Promise<void>;
  /** Why it was stopped, when it was. */
  stopReason?: string;
}

const state = processState('team-ai:chats', () => ({
  /** The turn running in each chat, and how to stop it. */
  running: new Map<string, ChatWork>(),
  /** Chats with a drain loop going: one per chat, so nothing loses track of a running turn. */
  draining: new Set<string>(),
  /** Chats kicked while their loop was finishing, to look again. */
  again: new Set<string>(),
  /** Tests only: where the turn's provider and MCP are. */
  seams: null as Pick<RunTeamTurnInput, 'endpointBaseUrl' | 'mcpUrl'> | null,
  /** Tests only: replaces the real runtime. */
  runner: null as typeof runTeamTurn | null,
}));

export function setTeamAiTestSeams(seams: Pick<RunTeamTurnInput, 'endpointBaseUrl' | 'mcpUrl'> | null, runner: typeof runTeamTurn | null = null) {
  state.seams = seams;
  state.runner = runner;
}

/** Send a member's message. Refused, with a reason, when Team AI can't answer. */
export async function sendToTeamAi(input: { chatId: string; memberId: string; clientSendId: string; text: string }) {
  const text = input.text.trim();
  if (!text) throw new q.TeamChatError('invalid', 'Write a message first.');
  if (text.length > TEAM_CHAT_MESSAGE_MAX) throw new q.TeamChatError('invalid', `Keep a message under ${TEAM_CHAT_MESSAGE_MAX.toLocaleString()} characters.`);
  const chat = q.getTeamChat(input.chatId);
  if (!chat || chat.status !== 'active') throw new q.TeamChatError('not_found', 'That chat is gone.');
  const member = q.getMember(input.memberId);
  if (!member || member.status !== 'active') throw new q.TeamError('not_allowed', 'Only a member of the team can talk with its AI.');
  // A retry of a send already accepted gets that send back, whatever the state now.
  const prior = q.findTeamChatSend(input.chatId, input.memberId, input.clientSendId);
  if (prior) {
    if (prior.message?.content !== text) throw new q.TeamChatError('conflict', 'That send id was already used for a different message.');
    return { turn: prior.turn, message: prior.message, created: false };
  }
  // A new one is refused, with nothing recorded, when Team AI can't answer:
  // the same send can be tried again once it can.
  const status = await teamAiStatus();
  if (status.state !== 'ready') {
    throw new q.TeamChatError('unavailable', status.reason ?? "Team AI is off. The team's owner can turn it on in Settings.");
  }
  const accepted = q.acceptTeamChatSend({ ...input, text });
  kickTeamChat(input.chatId);
  return { turn: q.getTeamChatTurn(accepted.turn.id) ?? accepted.turn, message: accepted.message, created: accepted.created };
}

/**
 * Run the chat's waiting turns, one after another. One loop per chat: a kick
 * while it runs only asks it to look again before it ends.
 */
export function kickTeamChat(chatId: string): void {
  if (state.draining.has(chatId)) {
    state.again.add(chatId);
    return;
  }
  state.draining.add(chatId);
  void drain(chatId).finally(() => {
    state.draining.delete(chatId);
    if (state.again.delete(chatId)) kickTeamChat(chatId);
  });
}

async function drain(chatId: string): Promise<void> {
  for (;;) {
    state.again.delete(chatId);
    const status = await teamAiStatus();
    if (status.state !== 'ready') {
      // Waiting turns can't be answered: say so on each, honestly.
      q.finishQueuedTeamChatTurns(chatId, status.state === 'off' ? 'cancelled' : 'failed', status.reason ?? 'Team AI is off.');
      return;
    }
    const turn = q.claimNextTeamChatTurn(chatId);
    if (!turn) return;
    let release!: () => void;
    const work: ChatWork = { turnId: turn.id, controller: new AbortController(), done: new Promise<void>((resolve) => { release = resolve; }) };
    state.running.set(chatId, work);
    try {
      await runOne(turn, work);
    } catch (err) {
      console.error('[team ai] turn failed unexpectedly:', err);
      q.finishTeamChatTurn(turn.id, 'failed', 'Team AI hit an error. Try again.');
    } finally {
      if (state.running.get(chatId) === work) state.running.delete(chatId);
      release();
    }
  }
}

async function runOne(turn: TeamChatTurnRecord, work: ChatWork): Promise<void> {
  const member = q.getMember(turn.memberId);
  if (!member || member.status !== 'active') {
    q.finishTeamChatTurn(turn.id, 'cancelled', 'The member who sent this left the team.');
    return;
  }
  const message = q.getChatEventById(turn.messageEventId);
  if (!message?.content) {
    q.finishTeamChatTurn(turn.id, 'failed', 'The message for this turn is gone.');
    return;
  }
  const authRevision = teamAiAuthRevision();
  const outcome = await (state.runner ?? runTeamTurn)({
    turn,
    memberName: member.name,
    text: message.content,
    signal: work.controller.signal,
    ...(state.seams ?? {}),
  });
  if (outcome.status === 'done') {
    q.finishTeamChatTurn(turn.id, 'done');
    recordTeamAiOutcome({ ok: true }, authRevision);
  } else if (outcome.status === 'cancelled') {
    q.finishTeamChatTurn(turn.id, 'cancelled', work.stopReason ?? 'Stopped.');
  } else {
    q.finishTeamChatTurn(turn.id, 'failed', outcome.error);
    if (outcome.code === 'credential_rejected') recordTeamAiOutcome({ ok: false, code: CREDENTIAL_REJECTED }, authRevision);
    else if (outcome.code !== 'no_subscription' && outcome.code !== 'no_key') recordTeamAiOutcome({ ok: false, code: outcome.code }, authRevision);
  }
}

/**
 * Stop Team AI's work, for one member (removed from the team) or everyone
 * (Team AI turned off): queued turns are cancelled, running ones stopped.
 * Resolves once the running ones have settled.
 */
export async function stopTeamAiWork(filter: { memberId?: string; turnId?: string } = {}, reason: string): Promise<void> {
  const { running } = q.cancelQueuedTeamChatTurns(filter, reason);
  const waits: Promise<void>[] = [];
  for (const turn of running) {
    const work = state.running.get(turn.chatSessionId);
    if (work && work.turnId === turn.id) {
      work.stopReason = reason;
      work.controller.abort();
      waits.push(work.done);
    } else {
      // Running in the database with nothing behind it here: it can't finish.
      q.finishTeamChatTurn(turn.id, 'interrupted', reason);
    }
  }
  await Promise.all(waits);
}

/** At the team's start: a turn left running is interrupted, never rerun. Waiting ones go on. */
export function resumeTeamAiAfterStart(): void {
  const interrupted = q.interruptRunningTeamChatTurns();
  if (interrupted) console.log(`[team ai] ${interrupted} turn(s) interrupted by the restart`);
  for (const chatId of q.teamChatsWithQueuedTurns()) kickTeamChat(chatId);
}

/** Tests: wait for every chat's work to settle, loops included. */
export async function settledTeamAi(): Promise<void> {
  for (;;) {
    if (state.running.size) await Promise.all([...state.running.values()].map((w) => w.done));
    else if (state.draining.size) await new Promise((resolve) => setTimeout(resolve, 5));
    else return;
  }
}
