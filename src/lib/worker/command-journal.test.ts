/**
 * What the command journal keeps beyond single commands (P2 review fixes):
 * placements the home released, each chat's generation, and delivered turns
 * that haven't ended, across a restart and a compaction. And a crash's torn
 * last line, repaired before anything is appended after it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkerCommand } from '@/lib/workers/protocol';
import { CommandJournal } from './command-journal';

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-command-journal-'));
  file = path.join(dir, 'commands.jsonl');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

let seq = 0;
function send(chat: string, generation: number | null, turnId: string, runId: string | null = `run-${turnId}`): WorkerCommand {
  seq += 1;
  return {
    id: `send-${turnId}`,
    seq,
    kind: 'send',
    target: { executionId: generation === null ? null : 'exec-1', chatSessionId: chat, generation },
    actor: { source: 'human' },
    issuedAt: new Date().toISOString(),
    payload: { turnId, runId },
  };
}

function deliver(journal: CommandJournal, command: WorkerCommand, reconciled = false): void {
  journal.received(command);
  journal.started(command.id);
  journal.finished(command.id, { state: 'delivered', ...(reconciled ? { result: { reconciled: true } } : {}) });
  journal.confirmed(command.id);
}

describe('the command journal', () => {
  it('keeps a released placement fenced across a restart', () => {
    const journal = new CommandJournal('home', file);
    journal.release('exec-1', 2);
    journal.release('exec-1', 1);
    const reopened = new CommandJournal('home', file);
    expect(reopened.released('exec-1', 1)).toBe(true);
    expect(reopened.released('exec-1', 2)).toBe(true);
    expect(reopened.released('exec-1', 3)).toBe(false);
    expect(reopened.released('exec-2', 1)).toBe(false);
  });

  it("gives a chat's events the generation of its newest command", () => {
    const journal = new CommandJournal('home', file);
    journal.received(send('chat-1', 1, 'a'));
    journal.received(send('chat-1', 3, 'b'));
    expect(journal.chatGeneration('chat-1')).toBe(3);
    expect(journal.chatGeneration('chat-2')).toBeNull();
  });

  it('keeps a delivered turn open until its result, across a restart', () => {
    const journal = new CommandJournal('home', file);
    deliver(journal, send('chat-1', 1, 'a'));
    deliver(journal, send('chat-1', 1, 'b'), true);
    journal.received(send('chat-1', 1, 'never-delivered'));
    expect(journal.openTurnOf('chat-1')).toMatchObject({ turnId: 'b', runId: 'run-b', reconciled: true });
    journal.turnEnded('b');
    const reopened = new CommandJournal('home', file);
    expect(reopened.openTurns()).toEqual([
      { commandId: 'send-a', chatSessionId: 'chat-1', turnId: 'a', runId: 'run-a', generation: 1, reconciled: false },
    ]);
  });

  it('keeps open turns, releases and generations through compaction, and forgets what it can', () => {
    const journal = new CommandJournal('home', file);
    deliver(journal, send('chat-1', 1, 'open'));
    for (let n = 0; n < 5; n++) {
      deliver(journal, send('chat-2', null, `ended-${n}`));
      journal.turnEnded(`ended-${n}`);
    }
    journal.release('exec-1', 1);
    journal.compact(0);
    const reopened = new CommandJournal('home', file);
    expect(reopened.openTurns().map((t) => t.turnId)).toEqual(['open']);
    expect(reopened.released('exec-1', 1)).toBe(true);
    expect(reopened.chatGeneration('chat-1')).toBe(1);
    // Ended turns went with their commands, and the cursor kept its place.
    expect(fs.readFileSync(file, 'utf8')).not.toContain('ended-0');
    expect(reopened.cursor()).toBeGreaterThan(0);
  });

  it('repairs a torn last line before appending, and keeps a whole one missing its newline', () => {
    const whole = JSON.stringify({ stage: 'released', executionId: 'exec-1', generation: 4, at: 'x' });
    fs.writeFileSync(file, whole);
    new CommandJournal('home', file).release('exec-2', 1);
    const reopened = new CommandJournal('home', file);
    expect(reopened.released('exec-1', 4)).toBe(true);
    expect(reopened.released('exec-2', 1)).toBe(true);

    fs.appendFileSync(file, '{"stage":"released","executionId":"exec-3"');
    new CommandJournal('home', file).release('exec-4', 1);
    const again = new CommandJournal('home', file);
    expect(again.released('exec-3', 1)).toBe(false);
    expect(again.released('exec-4', 1)).toBe(true);
  });
});
