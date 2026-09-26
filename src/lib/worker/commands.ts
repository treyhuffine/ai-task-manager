/**
 * Carrying out the home's commands on this computer (docs/homes-build.md,
 * P2 protocol "Command receipt and recovery", and P2.3).
 *
 * A command is journaled `received` before anything acts on it, and a
 * command already journaled is never applied again: its recorded outcome is
 * acknowledged instead. Commands for the same chat or execution run in the
 * order they came; different ones run side by side. After a restart, each
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
}

export interface CommandKindHandler {
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
}

export class CommandProcessor {
  private readonly chains = new Map<string, Promise<void>>();

  constructor(private readonly options: CommandProcessorOptions) {}

  /** A command arrived on the stream. */
  receive(command: WorkerCommand): void {
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
      (entry) => new Promise<void>((resolve) => this.enqueue(entry.command, () => this.recoverOne(entry).finally(resolve))),
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
    await Promise.all([...this.chains.values()]);
  }

  private enqueue(command: WorkerCommand, run: () => Promise<void>): void {
    const key = command.target.executionId ?? command.target.chatSessionId ?? '_computer';
    const previous = this.chains.get(key) ?? Promise.resolve();
    const next = previous.then(run).catch((err: unknown) => {
      console.error(`[worker] command ${command.id} (${command.kind}) failed unexpectedly:`, err);
    });
    this.chains.set(key, next);
    void next.finally(() => {
      if (this.chains.get(key) === next) this.chains.delete(key);
    });
  }

  private context(command: WorkerCommand): CommandContext {
    return { target: this.options.target, markStarted: () => this.options.journal.started(command.id) };
  }

  private async execute(command: WorkerCommand): Promise<void> {
    const handler = this.options.handlers[command.kind];
    let ack: WorkerCommandAckBody;
    if (!handler) {
      ack = { state: 'failed', error: `This computer doesn't handle "${command.kind}" commands yet. Update Ri here.` };
    } else {
      try {
        ack = await handler.run(command, this.context(command));
      } catch (err) {
        ack = { state: 'failed', error: err instanceof Error ? err.message : String(err) };
      }
    }
    this.options.journal.finished(command.id, ack);
    this.options.onHandled?.(command);
    await this.sendAck(command.id, ack);
  }

  private async recoverOne(entry: JournaledCommand): Promise<void> {
    const { command } = entry;
    const handler = this.options.handlers[command.kind];
    let ack: WorkerCommandAckBody;
    if (!handler) {
      ack = { state: 'failed', error: `This computer doesn't handle "${command.kind}" commands yet. Update Ri here.` };
    } else {
      try {
        ack = await handler.recover(command, entry.stage === 'started' ? 'started' : 'received', this.context(command));
      } catch (err) {
        // A recovery that can't decide leaves the outcome unknown: shown as
        // such, and retried only when the person asks.
        ack = { state: 'uncertain', error: `Recovery after a restart failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
    this.options.journal.finished(command.id, ack);
    this.options.onHandled?.(command);
    await this.sendAck(command.id, ack);
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
