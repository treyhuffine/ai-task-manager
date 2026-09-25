/**
 * The worker's event journal (docs/homes-build.md, P2 protocol "Events", and
 * P2.3). Everything the worker's runner reports is appended here with the
 * next position, flushed to disk, before it's posted. The home acknowledges
 * the highest contiguous position it stored, and the worker resends from the
 * one after. So a crash, a dropped connection or a home outage loses nothing,
 * and a replay changes nothing at home.
 *
 * `<workDir>/journal/<homeId>.jsonl`, with the acknowledged position in
 * `<homeId>.acked` beside it. The acknowledged prefix is compacted away.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getWorkDir } from '@/lib/config/paths';
import type { WorkerEvent } from '@/lib/workers/protocol';
import { appendLine, readJsonLines, repairTornTail, writeFileAtomic } from './durable-file';

export type JournalInput = WorkerEvent extends infer E ? (E extends WorkerEvent ? Omit<E, 'position'> : never) : never;

export function eventJournalPath(homeId: string): string {
  return path.join(getWorkDir(), 'journal', `${homeId}.jsonl`);
}

export class EventJournal {
  private readonly file: string;
  private readonly ackedFile: string;
  private pendingEvents: WorkerEvent[] = [];
  private last = 0;
  private acked = 0;

  constructor(homeId: string, file = eventJournalPath(homeId)) {
    this.file = file;
    this.ackedFile = `${file.replace(/\.jsonl$/, '')}.acked`;
    this.acked = fs.existsSync(this.ackedFile) ? Number(fs.readFileSync(this.ackedFile, 'utf8').trim()) || 0 : 0;
    repairTornTail(this.file);
    for (const event of readJsonLines<WorkerEvent>(this.file)) {
      this.last = Math.max(this.last, event.position);
      if (event.position > this.acked) this.pendingEvents.push(event);
    }
    this.last = Math.max(this.last, this.acked);
    this.pendingEvents.sort((a, b) => a.position - b.position);
  }

  /** Journal one event at the next position. It's on disk when this returns. */
  append(input: JournalInput): WorkerEvent {
    const event = { ...input, position: this.last + 1 } as WorkerEvent;
    appendLine(this.file, JSON.stringify(event));
    this.last = event.position;
    this.pendingEvents.push(event);
    return event;
  }

  /**
   * The home already holds positions up to `homeAcked` from this computer,
   * past anything in this journal: it was cleared or this is a new install.
   * Number on from there, or the home would take new events for replays.
   */
  rebase(homeAcked: number): boolean {
    if (homeAcked <= this.last) return false;
    this.last = homeAcked;
    this.acked = homeAcked;
    writeFileAtomic(this.ackedFile, `${homeAcked}\n`);
    return true;
  }

  /** Events the home hasn't acknowledged, oldest first. */
  pending(limit = Number.POSITIVE_INFINITY): WorkerEvent[] {
    return this.pendingEvents.slice(0, limit);
  }

  lastPosition(): number {
    return this.last;
  }

  ackedPosition(): number {
    return this.acked;
  }

  /**
   * The home holds everything up to `position`. Moving backwards is how the
   * home asks for a resend (its answer names what it really has), so the
   * pending list is rebuilt from the file when that happens.
   */
  ack(position: number): void {
    if (position === this.acked) return;
    if (position < this.acked) {
      this.acked = position;
      writeFileAtomic(this.ackedFile, `${position}\n`);
      this.pendingEvents = readJsonLines<WorkerEvent>(this.file)
        .filter((e) => e.position > position)
        .sort((a, b) => a.position - b.position);
      return;
    }
    this.acked = Math.min(position, this.last);
    writeFileAtomic(this.ackedFile, `${this.acked}\n`);
    this.pendingEvents = this.pendingEvents.filter((e) => e.position > this.acked);
    this.compact();
  }

  /** Rewrite the file without the acknowledged prefix once it's large. */
  private compact(threshold = 1000): void {
    const lines = fs.existsSync(this.file) ? fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).length : 0;
    if (lines - this.pendingEvents.length < threshold) return;
    writeFileAtomic(this.file, this.pendingEvents.map((e) => JSON.stringify(e)).join('\n') + (this.pendingEvents.length ? '\n' : ''));
  }
}
