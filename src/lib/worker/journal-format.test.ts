import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CommandJournal } from './command-journal';
import { EventJournal } from './event-journal';
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-journal-format-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });
it('adopts old format-1 events without rewriting pending events or acknowledgements', () => {
  const file = path.join(root, 'events.jsonl');
  const event = { kind: 'signal', position: 8, eventId: 'e', chatSessionId: 'chat', signal: { type: 'running', running: false } };
  const original = JSON.stringify(event) + '\n';
  fs.writeFileSync(file, original); fs.writeFileSync(path.join(root, 'events.acked'), '7\n');
  const journal = new EventJournal('home', file);
  expect(journal.pending()).toEqual([event]); expect(journal.ackedPosition()).toBe(7);
  expect(fs.readFileSync(file, 'utf8')).toBe(original);
  expect(fs.readFileSync(`${file}.format`, 'utf8')).toBe('1\n');
  journal.ack(8);
  expect(new EventJournal('home', file).pending()).toEqual([]);
});
it.each(['commands', 'events'])('rejects a newer %s format before repairing or changing any bytes', kind => {
  const file = path.join(root, `${kind}.jsonl`);
  fs.writeFileSync(file, '{unknown newer partial record'); fs.writeFileSync(`${file}.format`, '2\n');
  expect(() => kind === 'commands' ? new CommandJournal('home', file) : new EventJournal('home', file)).toThrow(/compatible Ri release/);
  expect(fs.readFileSync(file, 'utf8')).toBe('{unknown newer partial record');
});

it('preflights old and unsupported journal markers without modifying files', async () => {
  const { vi } = await import('vitest');
  vi.stubEnv('RI_WORK_DIR', root);
  const { assertWorkerJournalFormats } = await import('./journal-formats');
  try {
    assertWorkerJournalFormats('home'); expect(fs.readdirSync(root)).toEqual([]);
    fs.mkdirSync(path.join(root, 'commands'));
    const marker = path.join(root, 'commands/home.jsonl.format'); fs.writeFileSync(marker, '99\n');
    expect(() => assertWorkerJournalFormats('home')).toThrow(/compatible Ri release/);
    expect(fs.readFileSync(marker, 'utf8')).toBe('99\n');
  } finally { vi.unstubAllEnvs(); }
});
