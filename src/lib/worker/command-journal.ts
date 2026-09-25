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
 * It also keeps what outlives a single command: the placements the home said
 * this computer no longer holds (`released`), which fence every older command
 * for them, and which delivered sends' turns have ended (`turn_ended`), so a
 * turn a restart cut off is reported rather than left running at home.
 *
 * `<workDir>/commands/<homeId>.jsonl`, one record per line, flushed to disk.
 */

import path from 'node:path';
import { getWorkDir } from '@/lib/config/paths';
import type { WorkerCommand, WorkerCommandAckBody } from '@/lib/workers/protocol';
import { appendLine, readJsonLines, repairTornTail, writeFileAtomic } from './durable-file';

type JournalRecord =
  | { stage: 'received'; commandId: string; at: string; command: WorkerCommand }
  | { stage: 'started'; commandId: string; at: string }
  | { stage: 'note'; commandId: string; at: string; data: Record<string, unknown> }
  | { stage: 'finished'; commandId: string; at: string; ack: WorkerCommandAckBody }
  | { stage: 'confirmed'; commandId: string; at: string }
  | { stage: 'released'; executionId: string; generation: number; at: string }
  | { stage: 'turn_ended'; turnId: string; at: string };

/** A send the harness accepted, and the turn it started. */
export interface DeliveredTurn {
  commandId: string;
  chatSessionId: string;
  turnId: string;
  runId: string | null;
  generation: number | null;
  /** Found in the native history after a restart, rather than delivered by this process. */
  reconciled: boolean;
}

export type CommandStage = 'received' | 'started' | 'finished' | 'confirmed';

export interface JournaledCommand {
  command: WorkerCommand;
  stage: CommandStage;
  ack: WorkerCommandAckBody | null;
  /** What a command recorded about its own progress, for its recovery. */
  notes: Record<string, unknown>;
}

export function commandJournalPath(homeId: string): string {
  return path.join(getWorkDir(), 'commands', `${homeId}.jsonl`);
}

export class CommandJournal {
  private readonly file: string;
  private readonly entries = new Map<string, JournaledCommand>();
  /** Per execution, the newest generation the home said this computer no longer holds. */
  private readonly releasedThrough = new Map<string, number>();
  private readonly endedTurns = new Set<string>();

  constructor(homeId: string, file = commandJournalPath(homeId)) {
    this.file = file;
    repairTornTail(this.file);
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
    // Keep the highest-numbered command, for the cursor, and each
    // execution's newest-generation command, for the placement fence.
    const keep = new Set<JournaledCommand>([confirmed.reduce((a, b) => (b.command.seq > a.command.seq ? b : a))]);
    const newestByExecution = new Map<string, JournaledCommand>();
    for (const entry of this.entries.values()) {
      const { executionId, generation } = entry.command.target;
      if (!executionId || generation === null) continue;
      const current = newestByExecution.get(executionId);
      if (!current || generation > (current.command.target.generation ?? -1)) newestByExecution.set(executionId, entry);
    }
    for (const entry of newestByExecution.values()) keep.add(entry);
    // Each chat's newest command, for the generation its events carry, and
    // every send whose turn hasn't ended, for recovery.
    const newestByChat = new Map<string, JournaledCommand>();
    for (const entry of this.entries.values()) {
      const chat = entry.command.target.chatSessionId;
      if (!chat || entry.command.target.generation === null) continue;
      const current = newestByChat.get(chat);
      if (!current || entry.command.seq > current.command.seq) newestByChat.set(chat, entry);
    }
    for (const entry of newestByChat.values()) keep.add(entry);
    const open = new Set(this.openTurns().map((t) => t.commandId));
    for (const entry of this.entries.values()) if (open.has(entry.command.id)) keep.add(entry);
    const lines: string[] = [];
    const at = new Date().toISOString();
    for (const [executionId, generation] of this.releasedThrough) {
      lines.push(JSON.stringify({ stage: 'released', executionId, generation, at }));
    }
    for (const entry of this.entries.values()) {
      if (entry.stage === 'confirmed' && !keep.has(entry)) {
        this.entries.delete(entry.command.id);
        continue;
      }
      lines.push(JSON.stringify({ stage: 'received', commandId: entry.command.id, at, command: entry.command }));
      if (entry.stage !== 'received') lines.push(JSON.stringify({ stage: 'started', commandId: entry.command.id, at }));
      if (Object.keys(entry.notes).length) lines.push(JSON.stringify({ stage: 'note', commandId: entry.command.id, at, data: entry.notes }));
      if (entry.ack) lines.push(JSON.stringify({ stage: 'finished', commandId: entry.command.id, at, ack: entry.ack }));
      if (entry.stage === 'confirmed') lines.push(JSON.stringify({ stage: 'confirmed', commandId: entry.command.id, at }));
      const turnId = sendTurn(entry.command)?.turnId;
      if (turnId && this.endedTurns.has(turnId)) lines.push(JSON.stringify({ stage: 'turn_ended', turnId, at }));
    }
    const kept = new Set([...this.entries.values()].map((e) => sendTurn(e.command)?.turnId).filter(Boolean));
    for (const turnId of [...this.endedTurns]) if (!kept.has(turnId)) this.endedTurns.delete(turnId);
    writeFileAtomic(this.file, lines.length ? `${lines.join('\n')}\n` : '');
  }

  private apply(record: JournalRecord): void {
    if (record.stage === 'released') {
      this.releasedThrough.set(record.executionId, Math.max(record.generation, this.releasedThrough.get(record.executionId) ?? 0));
      return;
    }
    if (record.stage === 'turn_ended') {
      this.endedTurns.add(record.turnId);
      return;
    }
    if (record.stage === 'received') {
      if (!this.entries.has(record.commandId)) {
        this.entries.set(record.commandId, { command: record.command, stage: 'received', ack: null, notes: {} });
      }
      return;
    }
    const entry = this.entries.get(record.commandId);
    if (!entry) return;
    if (record.stage === 'note') {
      entry.notes = { ...entry.notes, ...record.data };
      return;
    }
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

  /** Record progress a command's recovery needs, such as the worktree it made. Flushed before it returns. */
  note(commandId: string, data: Record<string, unknown>): void {
    this.write({ stage: 'note', commandId, at: new Date().toISOString(), data });
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

  /**
   * The home no longer places this execution here at this generation or any
   * before it. Journaled, so every older command for it stays fenced across a
   * restart, including ones received and not yet carried out.
   */
  release(executionId: string, generation: number): void {
    if ((this.releasedThrough.get(executionId) ?? 0) >= generation) return;
    this.write({ stage: 'released', executionId, generation, at: new Date().toISOString() });
  }

  /** Whether the home has released this execution's placement at this generation. */
  released(executionId: string, generation: number): boolean {
    return generation <= (this.releasedThrough.get(executionId) ?? 0);
  }

  /**
   * The placement generation a chat's events belong to: that of the newest
   * command for it, which is what started or last drove its session here.
   * Null for a chat without an execution, or one this computer has no
   * command for.
   */
  chatGeneration(chatSessionId: string): number | null {
    let newest: WorkerCommand | null = null;
    for (const { command } of this.entries.values()) {
      if (command.target.chatSessionId !== chatSessionId || command.target.generation === null) continue;
      if (!newest || command.seq > newest.seq) newest = command;
    }
    return newest?.target.generation ?? null;
  }

  /** A delivered send's turn has ended: its result is in the event journal. */
  turnEnded(turnId: string): void {
    if (this.endedTurns.has(turnId)) return;
    this.write({ stage: 'turn_ended', turnId, at: new Date().toISOString() });
  }

  /** Sends the harness accepted whose turn hasn't ended, oldest first. */
  openTurns(): DeliveredTurn[] {
    const open: Array<[number, DeliveredTurn]> = [];
    for (const entry of this.entries.values()) {
      const turn = sendTurn(entry.command);
      if (!turn || entry.ack?.state !== 'delivered' || this.endedTurns.has(turn.turnId)) continue;
      open.push([
        entry.command.seq,
        {
          commandId: entry.command.id,
          chatSessionId: entry.command.target.chatSessionId!,
          turnId: turn.turnId,
          runId: turn.runId,
          generation: entry.command.target.generation,
          reconciled: (entry.ack.result as { reconciled?: boolean } | undefined)?.reconciled === true,
        },
      ]);
    }
    return open.sort((a, b) => a[0] - b[0]).map(([, turn]) => turn);
  }

  /** The placement generation of the send that started this turn, or carried this run. Undefined when there's no such send. */
  sendGeneration(match: { turnId: string } | { runId: string }): number | null | undefined {
    for (const { command } of this.entries.values()) {
      const turn = sendTurn(command);
      if (!turn) continue;
      if ('turnId' in match ? turn.turnId === match.turnId : turn.runId === match.runId) return command.target.generation;
    }
    return undefined;
  }

  /** The newest placement generation of an execution this computer has received a command for. */
  highestGeneration(executionId: string): number | null {
    let newest: number | null = null;
    for (const { command } of this.entries.values()) {
      if (command.target.executionId !== executionId || command.target.generation === null) continue;
      newest = newest === null ? command.target.generation : Math.max(newest, command.target.generation);
    }
    return newest;
  }

  /**
   * The placements this computer holds, as its commands show them: each
   * execution at the newest generation seen, with the chats it ran. The
   * heartbeat reports them, and the home answers with any that moved.
   */
  placements(): Array<{ executionId: string; generation: number; chatSessionIds: string[] }> {
    const byExecution = new Map<string, { generation: number; chats: Set<string> }>();
    for (const { command } of this.entries.values()) {
      const { executionId, generation, chatSessionId } = command.target;
      if (!executionId || generation === null) continue;
      const current = byExecution.get(executionId);
      if (!current || generation > current.generation) {
        byExecution.set(executionId, { generation, chats: new Set(chatSessionId ? [chatSessionId] : []) });
      } else if (generation === current.generation && chatSessionId) {
        current.chats.add(chatSessionId);
      }
    }
    return [...byExecution].map(([executionId, p]) => ({ executionId, generation: p.generation, chatSessionIds: [...p.chats] }));
  }

  /** The worktree this computer prepared for an execution, from its newest prepare that made one. */
  preparedWorktree(executionId: string): string | null {
    let found: { seq: number; path: string } | null = null;
    for (const entry of this.entries.values()) {
      const { command } = entry;
      if (command.kind !== 'prepare' || command.target.executionId !== executionId) continue;
      const path = (entry.notes.worktreePath ?? (entry.ack?.result as { worktreePath?: unknown } | undefined)?.worktreePath) as string | undefined;
      if (typeof path === 'string' && (!found || command.seq > found.seq)) found = { seq: command.seq, path };
    }
    return found?.path ?? null;
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

/** The turn a send starts, from its payload. */
function sendTurn(command: WorkerCommand): { turnId: string; runId: string | null } | null {
  if (command.kind !== 'send' || !command.target.chatSessionId) return null;
  const payload = command.payload as { turnId?: unknown; runId?: unknown } | null;
  if (typeof payload?.turnId !== 'string') return null;
  return { turnId: payload.turnId, runId: typeof payload.runId === 'string' ? payload.runId : null };
}
