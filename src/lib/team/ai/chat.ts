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
import type { TeamChatTurnRecord, Attachment } from '@/db/types';

import { isNativeTeamChat, teamChatAvailability, runNativeTeamTurn, bindTeamChatAgent } from './native-turn';
import { isRunning, hasBackgroundTasks, activeSendCount } from '@/lib/runner/live-state';
import { chatLifecycleClosing, chatLifecycleReason, executionLifecycleClosing, closeChatAdmission } from '@/lib/sessions/lifecycle-admission';

export const TEAM_CHAT_MESSAGE_MAX = 20_000;

interface ChatWork {
  turnId: string;
  controller: AbortController;
  done: Promise<void>;
  /** Why it was stopped, when it was. */
  stopReason?: string;
  pendingStop?: { reason: string; confirmed: Promise<boolean> };
  closeFailure?: string;
  delivered?: boolean;
  idleSince?: number;
}

const state = processState('team-ai:chats', () => ({
  /** The turn running in each chat, and how to stop it. */
  running: new Map<string, ChatWork>(),
  /** Chats with a drain loop going: one per chat, so nothing loses track of a running turn. */
  draining: new Set<string>(),
  /** Chats kicked while their loop was finishing, to look again. */
  again: new Set<string>(),
  blocked: new Map<string, { turn: TeamChatTurnRecord; reason: string }>(),
  /** Tests only: replaces the real runtime. */
  runner: null as typeof runNativeTeamTurn | null,
}));

export function setTeamAiRunnerForTests(runner: typeof runNativeTeamTurn | null) { state.runner = runner; }

/** Label the active turn before a lifecycle close can settle its SDK receipt.
 * Queued turns remain untouched until archive's final dirty check succeeds. */
export function markTeamChatStop(chatId: string, reason: string): (closed: boolean) => void {
  const work = state.running.get(chatId);
  if (!work) return () => {};
  let settle!: (closed: boolean) => void;
  const intent = { reason, confirmed: new Promise<boolean>(resolve => { settle = resolve; }) };
  work.pendingStop = intent;
  return closed => {
    if (work.pendingStop === intent) work.pendingStop = undefined;
    if (closed) work.stopReason = reason;
    settle(closed);
  };
}

/** Send a member's message. Refused, with a reason, when Team AI can't answer. */
export async function sendToTeamAi(input: { chatId: string; memberId: string; requestingApiKeyId?: string | null; clientSendId: string; messageId?: string; attachments?: Attachment[]; actionIntentHash?: string; senderSessionId?: string; text: string }) {
  const text = input.text.trim();
  if (!text) throw new q.TeamChatError('invalid', 'Write a message first.');
  if (text.length > TEAM_CHAT_MESSAGE_MAX) throw new q.TeamChatError('invalid', `Keep a message under ${TEAM_CHAT_MESSAGE_MAX.toLocaleString()} characters.`);
  let chat = q.getTeamChat(input.chatId);
  if (!chat) throw new q.TeamChatError('not_found', 'That chat is gone.');
  if (chat.surfaceKind === 'result_review') throw new q.TeamChatError('conflict', 'An assigned background reviewer cannot receive ordinary continuation messages. Use the result actions for another review, or answer its pending question through the existing input controls.');
  const member = q.getMember(input.memberId);
  if (!member || member.status !== 'active') throw new q.TeamError('not_allowed', 'Only a member of the team can talk with its AI.');
  if (isNativeTeamChat(chat.id) && (!input.requestingApiKeyId || q.memberForApiKey(input.requestingApiKeyId)?.id !== member.id)) throw new q.TeamError('not_allowed', 'A native team send needs its active member sign-in.');
  // A retry of a send already accepted gets that send back, whatever the state now.
  const prior = q.findTeamChatSend(input.chatId, input.memberId, input.clientSendId);
  if (prior) {
    if (!q.matchesTeamChatSend(prior.message, { text, attachments: input.attachments, actionIntentHash: input.actionIntentHash })) throw new q.TeamChatError('conflict', 'That send id was already used for a different message.');
    return { turn: prior.turn, message: prior.message, created: false };
  }
  if (chat.status !== 'active') throw new q.TeamChatError('not_found', 'That chat is gone.');
  const blocked = state.blocked.get(chat.id);
  if (blocked) {
    const result = await (await import('@/lib/executor/adapter')).close(chat.id, { source: 'system' });
    if (!result.closed) throw new q.TeamChatError('unavailable', blocked.reason);
    state.blocked.delete(chat.id);
  }
  if (!chat.workspaceId) {
    if (!input.requestingApiKeyId) throw new q.TeamError('not_allowed', 'This send needs its active member sign-in.');
    chat = await bindTeamChatAgent(chat.id, { scope: 'member', location: 'elsewhere', memberId: member.id,
      apiKeyId: input.requestingApiKeyId, workerDeviceId: null, sessionChatId: input.senderSessionId ?? null });
  }
  // A new one is refused, with nothing recorded, when Team AI can't answer:
  // the same send can be tried again once it can.
  const status = await teamChatAvailability(chat.id);
  if (status.state !== 'ready') {
    throw new q.TeamChatError('unavailable', status.reason ?? "Team AI is off. The team's owner can turn it on in Settings.");
  }
  if (q.getTeamChat(chat.id)?.workspaceId !== chat.workspaceId) throw new q.TeamChatError('conflict', 'This chat changed its team agent. Your draft is kept.');
  if (chatLifecycleClosing(chat.id)) throw new q.TeamChatError('conflict', chatLifecycleReason(chat.id) ?? 'This chat is being closed. Your draft is kept.');
  if (executionLifecycleClosing(chat.executionId)) throw new q.TeamChatError('conflict', 'This execution is being archived. Your draft is kept.');
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
    if (state.blocked.has(chatId) || chatLifecycleClosing(chatId) || executionLifecycleClosing(q.getTeamChat(chatId)?.executionId)) return;
    state.again.delete(chatId);
    if (!q.hasQueuedTeamChatTurns(chatId)) return;
    const status = await teamChatAvailability(chatId);
    if (status.state !== 'ready') {
      // Waiting turns can't be answered: say so on each, honestly.
      q.finishQueuedTeamChatTurns(chatId, status.state === 'off' ? 'cancelled' : 'failed', status.reason ?? 'Team AI is off.');
      return;
    }
    // The provider may have finished our request while keeping a background
    // task or self-initiated turn alive. Do not bind the next member yet.
    if (isRunning(chatId) || hasBackgroundTasks(chatId) || activeSendCount(chatId)) {
      await new Promise(resolve => { const timer = setTimeout(resolve, 100); timer.unref?.(); });
      continue;
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
  const outcome = await (state.runner ?? runNativeTeamTurn)({
    turn,
    memberName: member.name,
    text: message.content,
    signal: work.controller.signal,
    onTaken: () => { work.delivered = true; },
  });
  if (work.pendingStop && outcome.status !== 'done' && (outcome.status === 'cancelled' || outcome.code !== 'stop_failed')) {
    const intent = work.pendingStop;
    if (await intent.confirmed) work.stopReason = intent.reason;
  }
  if (outcome.status === 'done') {
    q.finishTeamChatTurn(turn.id, 'done');
  } else if (outcome.status === 'cancelled' || (outcome.code !== 'stop_failed' && work.stopReason !== undefined)) {
    const reason = work.stopReason ?? (outcome.status === 'cancelled' ? outcome.reason : undefined);
    q.finishTeamChatTurn(turn.id, 'cancelled', reason ?? 'This turn was cancelled. Send again if it is still needed.');
  } else {
    q.finishTeamChatTurn(turn.id, 'failed', outcome.error);
    if (outcome.code === 'stop_failed') {
      work.closeFailure = outcome.error;
      state.blocked.set(turn.chatSessionId, { turn, reason: outcome.error });
      q.finishQueuedTeamChatTurns(turn.chatSessionId, 'failed', outcome.error);
    }
  }
}

/**
 * Stop Team AI's work, for one member (removed from the team) or everyone
 * (Team AI turned off): queued turns are cancelled, running ones stopped.
 * Resolves once the running ones have settled.
 */
export async function stopTeamAiWork(filter: { memberId?: string; apiKeyId?: string; turnId?: string; chatId?: string } = {}, reason: string, options: { allowUnconfirmed?: boolean } = {}): Promise<void> {
  // Only a configuration already saved uses this option. Keep its runtime
  // block and explicit Restart recovery, without reporting a failed save or
  // repeatedly retrying a known failed close on each settings edit.
  const { hasUnconfirmedClose } = await import('@/lib/executor/adapter');
  const { running } = q.cancelQueuedTeamChatTurns(filter, reason);
  const waits: Promise<void>[] = [];
  for (const [chatId, blocked] of state.blocked) {
    const turn = blocked.turn;
    if ((filter.chatId && filter.chatId !== chatId) || (filter.turnId && filter.turnId !== turn.id)
      || (filter.memberId && filter.memberId !== turn.memberId) || (filter.apiKeyId && filter.apiKeyId !== turn.requestingApiKeyId)) continue;
    if (options.allowUnconfirmed && hasUnconfirmedClose(chatId)) continue;
    waits.push((async () => {
      const result = await (await import('@/lib/executor/adapter')).close(chatId, { source: 'system' });
      if (!result.closed) throw new Error(blocked.reason);
      if (state.blocked.get(chatId) === blocked) state.blocked.delete(chatId);
    })());
  }
  for (const turn of running) {
    const work = state.running.get(turn.chatSessionId);
    if (work && work.turnId === turn.id) {
      work.stopReason = reason;
      work.controller.abort();
      waits.push(work.done.then(() => { if (work.closeFailure && !(options.allowUnconfirmed && hasUnconfirmedClose(turn.chatSessionId))) throw new Error(work.closeFailure); }));
    } else {
      // Running in the database with nothing behind it here: it can't finish.
      q.finishTeamChatTurn(turn.id, 'interrupted', reason);
    }
  }
  // A completed member turn can leave background work or a self-started turn.
  // Its most recently started member retains that chat credential attribution.
  const { listLiveHarnessSessions } = await import('@/lib/runner/local-runner');
  const close = (await import('@/lib/executor/adapter')).close;
  const releases: Array<() => void> = [];
  const affected = listLiveHarnessSessions().filter(chatId => {
    if (!q.getTeamChat(chatId) || (filter.chatId && filter.chatId !== chatId)) return false;
    const turn = q.latestStartedTeamChatTurn(chatId);
    return (!filter.turnId || filter.turnId === turn?.id) && (!filter.memberId || filter.memberId === turn?.memberId)
      && (!filter.apiKeyId || filter.apiKeyId === turn?.requestingApiKeyId);
  });
  for (const chatId of affected) if (!chatLifecycleClosing(chatId)) releases.push(closeChatAdmission(chatId));
  try {
    await Promise.all(waits);
    const reports = await Promise.all(affected.map(async chatId => {
      const report = options.allowUnconfirmed && hasUnconfirmedClose(chatId)
        ? { closed: false, error: undefined }
        : await close(chatId, { source: 'system' });
      return { chatId, ...report };
    }));
    const failed = reports.filter(report => !report.closed && !(options.allowUnconfirmed && hasUnconfirmedClose(report.chatId)));
    if (failed.length) throw new Error(failed.map(report => `${q.getChatSession(report.chatId)?.label ?? 'A shared chat'}: ${report.error ?? 'The harness did not confirm it stopped.'}`).join(' '));
  } finally {
    for (const release of releases) release();
    for (const chatId of affected) if (!chatLifecycleClosing(chatId) && !executionLifecycleClosing(q.getTeamChat(chatId)?.executionId)) kickTeamChat(chatId);
  }
}

/** At the team's start: a turn left running is interrupted, never rerun. Waiting ones go on. */
export function resumeTeamAiAfterStart(): void {
  for (const chat of q.listTeamChats({ includeArchived: true })) if (!chat.workspaceId) {
    q.finishQueuedTeamChatTurns(chat.id, 'cancelled', 'The previous Team AI engine was retired. Send a new message to continue.');
  }
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

/** The ordinary health check reconciles local transcripts. Team recovery never
 * automatically replays a member's interrupted request. */
export function startTeamChatMaintenance() {
  const root = q.getHome()?.id;
  if (!root) return;
  const timers = processState('team-ai:health-timers', () => new Map<string, ReturnType<typeof setInterval>>());
  if (timers.has(root)) return;
  let checking = false;
  const timer = setInterval(() => {
    if (checking) return;
    checking = true;
    void import('@/lib/perf/recorder').then(({ perfScope }) => perfScope('timer:team-chat-health', async () => {
      await checkTeamChatHealth();
    })).catch(error => console.warn('[team] chat health check failed', error)).finally(() => { checking = false; });
  }, 60_000);
  timer.unref?.(); timers.set(root, timer);
}

/** A lost completion receipt cannot hold the queue forever after the ordinary
 * runner is confirmed idle. Busy turns and background tasks have no time cap. */
export async function checkTeamChatHealth(now = Date.now()) {
  const { healthCheckSession } = await import('@/lib/executor/health');
  for (const [chatId, work] of state.running) {
    const health = await healthCheckSession(chatId, { redispatchOrphans: false });
    if (state.running.get(chatId) !== work || !work.delivered) continue;
    if (isRunning(chatId) || hasBackgroundTasks(chatId) || activeSendCount(chatId)) { work.idleSince = undefined; continue; }
    if (health.classification === 'dead' || (work.idleSince !== undefined && now - work.idleSince >= 1_000)) {
      const terminal = q.getLastChatEventBySource(chatId, 'result');
      const raw = terminal?.raw as { riTeamTurnId?: string; isError?: boolean; terminalReason?: string | null } | null;
      if (raw?.riTeamTurnId === work.turnId && raw.isError === false && raw.terminalReason == null) {
        // Durable, exact-turn terminal evidence can recover a lost live receipt.
        // Assistant prose alone never proves completion and is not replayed.
        const runId = (await import('@/lib/runs/artifact-bucket')).getActiveRunForSession(chatId);
        const turn = q.getTeamChatTurn(work.turnId);
        const run = runId ? q.getRun(runId) : null;
        (await import('@/lib/executor/home-sink')).homeSink.signal(chatId, { type: 'turn_result', turnId: work.turnId,
          runId: run?.sourceEventId === turn?.messageEventId ? runId : null, ok: true, error: null, summary: terminal?.content });
        await work.done;
      } else {
        await stopTeamAiWork({ turnId: work.turnId }, 'The harness ended without confirming this turn. Send again if it is still needed.');
      }
    } else work.idleSince = now;
  }
}
