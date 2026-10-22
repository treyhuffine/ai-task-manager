/**
 * Carrying out the home's commands on this device (docs/homes-build.md,
 * P2 protocol "Command receipt and recovery", and P2.3).
 *
 * A command is journaled `received` before anything acts on it, and a
 * command already journaled is never applied again: its recorded outcome is
 * acknowledged instead. Commands for the same chat or execution run in the
 * order they came; different ones run side by side. While a recycle waits
 * for a turn to end, controls for ongoing work may pass it so a permission answer
 * or interrupt can finish the turn. Later sends still wait. After a restart, each
 * command left received or started goes through its kind's recovery rule,
 * so an effect that isn't safe to repeat never runs twice. Acknowledgements
 * are sent after the outcome is journaled, and resent until the home
 * confirms them.
 *
 * Each kind registers how it runs and how it recovers together, so a kind
 * can't exist without a recovery rule.
 */

import type { WorkerCommandKind } from '@/db/types';
import type { WorkerCommand, WorkerCommandAckBody } from '@/lib/workers/protocol';
import { WorkerNetworkError, WorkerStoppedError, workerFetch, type WorkerTarget } from './client';
import type { CommandJournal, JournaledCommand } from './command-journal';

export interface CommandContext {
  target: WorkerTarget;
  /** Journal `started`. Call it before any effect outside the journal. */
  markStarted(): void;
  /** An idle wait before changing settings, during which this chat's controls remain usable. */
  waitForTurnEnd?(wait: () => Promise<void>): Promise<void>;
}

export interface CommandKindHandler {
  /** Whether another chat already has work this control can service during an idle wait. */
  canPassIdleWait?(command: WorkerCommand): boolean;
  run(command: WorkerCommand, ctx: CommandContext): Promise<WorkerCommandAckBody>;
  /**
   * A restart interrupted this command after it was received (`received`) or
   * after it began its effect (`started`). Decide its outcome without
   * repeating an effect that isn't safe to repeat.
   */
  recover(command: WorkerCommand, stage: 'received' | 'started', ctx: CommandContext): Promise<WorkerCommandAckBody>;
}

export type CommandHandlers = Partial<Record<WorkerCommandKind, CommandKindHandler>>;

export interface CommandProcessorOptions {
  journal: CommandJournal;
  handlers: CommandHandlers;
  target: WorkerTarget;
  /** The home said stop while acknowledging (revoked, another protocol). */
  onStopped?: (err: WorkerStoppedError) => void;
  /** A command was carried out or recovered, and its outcome journaled. */
  onHandled?: (command: WorkerCommand) => void;
  /** A safe update has paused new effects while preserving received work. */
  paused?: () => boolean;
}

export class WorkerCommandDeferredError extends Error {}

interface QueuedCommand {
  command: WorkerCommand;
  run: () => Promise<void>;
  done: () => void;
  cancelled?: boolean;
}

interface TargetQueue {
  pending: QueuedCommand[];
  active: QueuedCommand | null;
  control: Promise<void> | null;
  waitingForTurn: boolean;
}

class ClosedBeforeSendError extends Error {}
class ProcessorStoppedError extends Error {}

export class CommandProcessor {
  private readonly queues = new Map<string, TargetQueue>();
  private readonly tasks = new Set<Promise<void>>();
  private readonly deferred = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly deferredAttempts = new Map<string, number>();
  private stopped = false;

  constructor(private readonly options: CommandProcessorOptions) {}

  /** A command arrived on the stream. */
  receive(command: WorkerCommand): void {
    if (this.stopped) return;
    const { journal } = this.options;
    const existing = journal.get(command.id);
    if (existing) {
      // Resent after a dropped connection or a lost acknowledgement. Never
      // applied again: a finished one is acknowledged again, and one still
      // in progress (here, or waiting for recovery) finishes on its own.
      if (existing.stage === 'finished' && existing.ack) void this.sendAck(command.id, existing.ack);
      return;
    }
    journal.received(command);
    this.enqueue(command, () => this.execute(command));
  }

  /** On start: settle what a restart interrupted, then resend acknowledgements the home hasn't confirmed. */
  recoverAll(): Promise<void> {
    const recovering = this.options.journal.interrupted().map(
      entry => this.enqueue(entry.command, () => this.recoverOne(entry)),
    );
    return Promise.all(recovering).then(() => this.resendAcks());
  }

  /** Acknowledgements journaled but not confirmed by the home. After a reconnect, for one. */
  async resendAcks(): Promise<void> {
    for (const entry of this.options.journal.unconfirmed()) {
      if (entry.ack) await this.sendAck(entry.command.id, entry.ack);
    }
  }

  /** Wait for everything queued so far. For tests and shutdown. */
  async idle(): Promise<void> {
    await Promise.all([...this.tasks]);
  }

  /** Leave unsent commands received for restart, rather than waking them
   * when worker teardown makes the old session idle. */
  stop(): void {
    this.stopped = true;
    for (const timer of this.deferred.values()) clearTimeout(timer);
    this.deferred.clear();
    this.deferredAttempts.clear();
    for (const queue of this.queues.values()) {
      for (const entry of queue.pending) entry.done();
      queue.pending = [];
    }
  }

  private enqueue(command: WorkerCommand, run: () => Promise<void>): Promise<void> {
    const key = this.key(command);
    let queue = this.queues.get(key);
    if (!queue) {
      queue = { pending: [], active: null, control: null, waitingForTurn: false };
      this.queues.set(key, queue);
    }
    let done!: () => void;
    const task = new Promise<void>((resolve) => { done = resolve; });
    this.tasks.add(task);
    void task.then(() => this.tasks.delete(task));
    queue.pending.push({ command, run, done });
    this.drain(key, queue);
    return task;
  }

  private key(command: WorkerCommand): string {
    return command.target.executionId ?? command.target.chatSessionId ?? '_device';
  }

  private canPassRecycle(command: WorkerCommand, chat: string | null): boolean {
    if (!chat) return false;
    if (command.kind === 'quiesce') {
      return (command.payload as { chatSessionIds?: string[] })?.chatSessionIds?.includes(chat) === true;
    }
    return ['answer_pending_input', 'interrupt', 'stop_task', 'stop'].includes(command.kind)
      && (command.target.chatSessionId === chat || this.options.handlers[command.kind]?.canPassIdleWait?.(command) === true);
  }

  private drain(key: string, queue: TargetQueue): void {
    if (this.stopped) return;
    if (queue.control) return;
    if (queue.active) {
      if (!queue.waitingForTurn) return;
      const index = queue.pending.findIndex(entry => this.canPassRecycle(entry.command, queue.active!.command.target.chatSessionId));
      if (index < 0) return;
      const [entry] = queue.pending.splice(index, 1);
      // Defer run until control is assigned: a synchronously completed wait
      // must still see and await this control before it retires the handle.
      queue.control = Promise.resolve().then(() => this.runEntry(entry!, queue)).finally(() => {
        queue.control = null;
        this.drain(key, queue);
      });
      return;
    }
    const entry = queue.pending.shift();
    if (!entry) {
      this.queues.delete(key);
      return;
    }
    queue.active = entry;
    void this.runEntry(entry, queue).finally(() => {
      queue.active = null;
      this.drain(key, queue);
    });
  }

  private async runEntry(entry: QueuedCommand, queue: TargetQueue): Promise<void> {
    try {
      await entry.run();
      const { command } = entry;
      if ((command.kind === 'stop' || command.kind === 'quiesce')
        && this.options.journal.get(command.id)?.ack?.state === 'delivered') {
        const chats = command.kind === 'stop' ? [command.target.chatSessionId]
          : (command.payload as { chatSessionIds: string[] }).chatSessionIds;
        if (queue.active?.command.kind === 'send'
          && queue.active.command.seq < command.seq && chats.includes(queue.active.command.target.chatSessionId)) {
          queue.active.cancelled = true;
        }
        // A close that passed a recycle also cancels the earlier sends held
        // behind it. Otherwise they would start a new process after the close.
        const cancelled = queue.pending.filter(item => item.command.kind === 'send'
          && item.command.seq < command.seq && chats.includes(item.command.target.chatSessionId!));
        queue.pending = queue.pending.filter(item => !cancelled.includes(item));
        await Promise.all(cancelled.map(async item => {
          try {
            await this.settle(item.command, { state: 'failed', error: 'The chat was closed before this message could be sent.' });
          } finally {
            item.done();
          }
        }));
        // Deferred inputs are outside the active queue while admission waits.
        // Closing the chat must retire these older sends as well.
        for (const [id, timer] of this.deferred) {
          const deferred = this.options.journal.get(id)?.command;
          if (deferred?.kind !== 'send' || deferred.seq >= command.seq || !chats.includes(deferred.target.chatSessionId)) continue;
          clearTimeout(timer);
          this.deferred.delete(id);
          await this.settle(deferred, { state: 'failed', error: 'The chat was closed before this message could be sent.' });
        }
      }
    } catch (err) {
      console.error(`[worker] command ${entry.command.id} (${entry.command.kind}) failed unexpectedly:`, err);
    } finally {
      entry.done();
    }
  }

  private async waitForTurnEnd(command: WorkerCommand, wait: () => Promise<void>): Promise<void> {
    if (this.stopped) throw new ProcessorStoppedError();
    const key = this.key(command);
    const queue = this.queues.get(key)!;
    if (!['recycle', 'send'].includes(command.kind) || queue.active?.command.id !== command.id) {
      throw new Error('Only an active recycle or send can wait for a turn.');
    }
    queue.waitingForTurn = true;
    this.drain(key, queue);
    try {
      await wait();
    } finally {
      queue.waitingForTurn = false;
      // A stop may have made the runner idle while its teardown is still in
      // progress. Finish it before recycling or admitting any later send.
      await queue.control;
    }
    if (this.stopped) throw new ProcessorStoppedError();
    if (queue.active.cancelled) throw new ClosedBeforeSendError('The chat was closed before this message could be sent.');
  }

  private async settle(command: WorkerCommand, ack: WorkerCommandAckBody): Promise<void> {
    this.deferredAttempts.delete(command.id);
    this.options.journal.finished(command.id, ack);
    this.options.onHandled?.(command);
    await this.sendAck(command.id, ack);
  }

  private context(command: WorkerCommand): CommandContext {
    return {
      target: this.options.target,
      markStarted: () => {
        if (this.stopped) throw new ProcessorStoppedError();
        if (this.options.paused?.()) throw new WorkerCommandDeferredError('The worker paused before command admission.');
        this.options.journal.started(command.id);
      },
      waitForTurnEnd: wait => this.waitForTurnEnd(command, wait),
    };
  }

  private async execute(command: WorkerCommand): Promise<void> {
    if (this.options.paused?.()) { this.retryDeferred(command); return; }
    const handler = this.options.handlers[command.kind];
    let ack: WorkerCommandAckBody;
    if (!handler) {
      ack = { state: 'failed', error: `This device doesn't handle "${command.kind}" commands yet. Update Ri here.` };
    } else {
      try {
        ack = await handler.run(command, this.context(command));
      } catch (err) {
        if (err instanceof WorkerCommandDeferredError) { this.retryDeferred(command); return; }
        if (err instanceof ProcessorStoppedError) return;
        ack = { state: 'failed', error: err instanceof Error ? err.message : String(err) };
      }
    }
    await this.settle(command, ack);
  }

  private async recoverOne(entry: JournaledCommand): Promise<void> {
    const { command } = entry;
    const handler = this.options.handlers[command.kind];
    let ack: WorkerCommandAckBody;
    if (!handler) {
      ack = { state: 'failed', error: `This device doesn't handle "${command.kind}" commands yet. Update Ri here.` };
    } else {
      try {
        ack = await handler.recover(command, entry.stage === 'started' ? 'started' : 'received', this.context(command));
      } catch (err) {
        if (err instanceof WorkerCommandDeferredError) { this.retryDeferred(command); return; }
        if (err instanceof ProcessorStoppedError) return;
        // A recovery that can't decide leaves the outcome unknown: shown as
        // such, and retried only when the person asks.
        ack = err instanceof ClosedBeforeSendError ? { state: 'failed', error: err.message }
          : { state: 'uncertain', error: `Recovery after a restart failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
    await this.settle(command, ack);
  }

  private retryDeferred(command: WorkerCommand): void {
    if (this.stopped || this.deferred.has(command.id)) return;
    const attempt = this.deferredAttempts.get(command.id) ?? 0;
    this.deferredAttempts.set(command.id, attempt + 1);
    const timer = setTimeout(() => {
      this.deferred.delete(command.id);
      if (!this.stopped && this.options.journal.get(command.id)?.stage === 'received') void this.enqueue(command, () => this.execute(command));
    }, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)));
    this.deferred.set(command.id, timer);
    timer.unref?.();
  }

  private async sendAck(commandId: string, ack: WorkerCommandAckBody): Promise<void> {
    try {
      const res = await workerFetch(this.options.target, `/api/workers/me/commands/${encodeURIComponent(commandId)}/ack`, {
        method: 'POST',
        body: JSON.stringify(ack),
      });
      // The home recorded it, or has no such command to record it for.
      if (res.ok || res.status === 404) this.options.journal.confirmed(commandId);
    } catch (err) {
      if (err instanceof WorkerStoppedError) this.options.onStopped?.(err);
      else if (!(err instanceof WorkerNetworkError)) throw err;
      // Unreachable: resent after the next reconnect.
    }
  }
}
