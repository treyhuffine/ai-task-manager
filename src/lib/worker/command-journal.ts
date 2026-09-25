/**
 * The worker's command journal (docs/homes-build.md, P2 protocol "Command
 * receipt and recovery", and P2.3).
 *
 * Seeing a command on the stream is not receipt, and applying it is not
 * acknowledgement: either can be cut off. So each command is journaled
 * `received` before anything acts on it, `started` before any effect outside
 * the journal, `finished` with its acknowledgement after, and `confirmed`
 * once the home has recorded that acknowledgement. A command already in the
 * journal is never applied again.
 *
 * `<workDir>/commands/<homeId>.jsonl`, one record per line, flushed to disk.
 */

import path from 'node:path';
import { getWorkDir } from '@/lib/config/paths';
import type { WorkerCommand, WorkerCommandAckBody } from '@/lib/workers/protocol';
import { appendLine, readJsonLines, writeFileAtomic } from './durable-file';

type JournalRecord =
  | { stage: 'received'; commandId: string; at: string; command: WorkerCommand }
  | { stage: 'started'; commandId: string; at: string }
  | { stage: 'finished'; commandId: string; at: string; ack: WorkerCommandAckBody }
  | { stage: 'confirmed'; commandId: string; at: string };

export type CommandStage = 'received' | 'started' | 'finished' | 'confirmed';

export interface JournaledCommand {
  command: WorkerCommand;
  stage: CommandStage;
  ack: WorkerCommandAckBody | null;
}

export function commandJournalPath(homeId: string): string {
  return path.join(getWorkDir(), 'commands', `${homeId}.jsonl`);
}

export class CommandJournal {
  private readonly file: string;
  private readonly entries = new Map<string, JournaledCommand>();

  constructor(homeId: string, file = commandJournalPath(homeId)) {
    this.file = file;
    for (const record of readJsonLines<JournalRecord>(this.file)) this.apply(record);
    this.compact();
  }

  /**
   * Drop confirmed commands, which the home never resends, once there are
   * enough to matter. The highest confirmed one stays, so the cursor keeps
   * its place.
   */
  compact(threshold = 500): void {
    const confirmed = [...this.entries.values()].filter((e) => e.stage === 'confirmed');
    if (confirmed.length <= threshold) return;
    const keep = confirmed.reduce((a, b) => (b.command.seq > a.command.seq ? b : a));
    const lines: string[] = [];
    for (const entry of this.entries.values()) {
      if (entry.stage === 'confirmed' && entry !== keep) {
        this.entries.delete(entry.command.id);
        continue;
      }
      const at = new Date().toISOString();
      lines.push(JSON.stringify({ stage: 'received', commandId: entry.command.id, at, command: entry.command }));
      if (entry.stage !== 'received') lines.push(JSON.stringify({ stage: 'started', commandId: entry.command.id, at }));
      if (entry.ack) lines.push(JSON.stringify({ stage: 'finished', commandId: entry.command.id, at, ack: entry.ack }));
      if (entry.stage === 'confirmed') lines.push(JSON.stringify({ stage: 'confirmed', commandId: entry.command.id, at }));
    }
    writeFileAtomic(this.file, lines.length ? `${lines.join('\n')}\n` : '');
  }

  private apply(record: JournalRecord): void {
    if (record.stage === 'received') {
      if (!this.entries.has(record.commandId)) {
        this.entries.set(record.commandId, { command: record.command, stage: 'received', ack: null });
      }
      return;
    }
    const entry = this.entries.get(record.commandId);
    if (!entry) return;
    entry.stage = record.stage;
    if (record.stage === 'finished') entry.ack = record.ack;
  }

  private write(record: JournalRecord): void {
    appendLine(this.file, JSON.stringify(record));
    this.apply(record);
  }

  get(commandId: string): JournaledCommand | null {
    return this.entries.get(commandId) ?? null;
  }

  /** Journal a command's receipt. Returns false when it was already received: never apply it twice. */
  received(command: WorkerCommand): boolean {
    if (this.entries.has(command.id)) return false;
    this.write({ stage: 'received', commandId: command.id, at: new Date().toISOString(), command });
    return true;
  }

  started(commandId: string): void {
    this.write({ stage: 'started', commandId, at: new Date().toISOString() });
  }

  finished(commandId: string, ack: WorkerCommandAckBody): void {
    this.write({ stage: 'finished', commandId, at: new Date().toISOString(), ack });
  }

  confirmed(commandId: string): void {
    if (this.entries.get(commandId)?.stage === 'confirmed') return;
    this.write({ stage: 'confirmed', commandId, at: new Date().toISOString() });
  }

  /**
   * Where the stream resumes: the highest number with every number before it
   * received, counting from the lowest this journal has seen. The home numbers
   * commands in order, so a gap is a command lost with a dropped connection.
   */
  cursor(): number {
    const seqs = [...this.entries.values()].map((e) => e.command.seq).sort((a, b) => a - b);
    if (seqs.length === 0) return 0;
    let cursor = seqs[0]!;
    for (const seq of seqs.slice(1)) {
      if (seq === cursor + 1) cursor = seq;
      else if (seq > cursor + 1) break;
    }
    return cursor;
  }

  /** Commands a restart interrupted: received or started, never finished. */
  interrupted(): JournaledCommand[] {
    return [...this.entries.values()].filter((e) => e.stage === 'received' || e.stage === 'started');
  }

  /** Commands finished whose acknowledgement the home hasn't confirmed. */
  unconfirmed(): JournaledCommand[] {
    return [...this.entries.values()].filter((e) => e.stage === 'finished');
  }
}
