import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getWorkDir, getWorkerConfigPath } from '@/lib/config/paths';
import { eventJournalPath } from './event-journal';
import { retireWorkerEnrollment } from './retire-enrollment';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-retire-enrollment-'));
  vi.stubEnv('RI_ROOT', root);
  vi.stubEnv('RI_CONFIG_DIR', path.join(root, 'separate-config'));
  vi.stubEnv('RI_WORK_DIR', path.join(root, 'separate-work'));
  for (const file of [eventJournalPath('home'), getWorkerConfigPath()]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `original ${path.basename(file)}\n`, { mode: 0o600 });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
function archives() {
  const directory = path.join(getWorkDir(), 'retired-workers');
  return fs.readdirSync(directory).map(name => path.join(directory, name));
}

it('leaves every live file intact after a partial copy and completes the same archive on retry', () => {
  const copy = fs.copyFileSync;
  const interrupted = vi.spyOn(fs, 'copyFileSync').mockImplementation((source, target, flags) => {
    if (source === getWorkerConfigPath()) throw new Error('disk full');
    return copy(source, target, flags);
  });
  expect(() => retireWorkerEnrollment('home', 'old-device')).toThrow('disk full');
  expect(fs.readFileSync(eventJournalPath('home'), 'utf8')).toBe('original home.jsonl\n');
  expect(fs.readFileSync(getWorkerConfigPath(), 'utf8')).toBe('original worker.json\n');
  interrupted.mockRestore();
  retireWorkerEnrollment('home', 'old-device');
  retireWorkerEnrollment('home', 'old-device');
  expect(archives()).toHaveLength(1);
  expect(fs.readFileSync(path.join(archives()[0], 'events.jsonl'), 'utf8')).toBe('original home.jsonl\n');
  expect(fs.readFileSync(path.join(archives()[0], 'worker.json'), 'utf8')).toBe('original worker.json\n');
  expect(JSON.parse(fs.readFileSync(path.join(archives()[0], 'identity.json'), 'utf8'))).toMatchObject({ homeId: 'home', deviceId: 'old-device' });
  expect(fs.existsSync(eventJournalPath('home'))).toBe(false);
  expect(fs.existsSync(getWorkerConfigPath())).toBe(false);
});

it('finishes after an interruption removing live paths without overwriting the archive', () => {
  const unlink = fs.unlinkSync;
  const interrupted = vi.spyOn(fs, 'unlinkSync').mockImplementation(file => {
    if (file === getWorkerConfigPath()) throw new Error('interrupted');
    return unlink(file);
  });
  expect(() => retireWorkerEnrollment('home', 'old-device')).toThrow('interrupted');
  expect(fs.existsSync(eventJournalPath('home'))).toBe(false);
  interrupted.mockRestore();
  retireWorkerEnrollment('home', 'old-device');
  expect(archives()).toHaveLength(1);
  expect(fs.existsSync(getWorkerConfigPath())).toBe(false);
  expect(fs.readFileSync(path.join(archives()[0], 'events.jsonl'), 'utf8')).toBe('original home.jsonl\n');
});

it('preserves both versions if a live file changed after an interrupted archive', () => {
  const copy = fs.copyFileSync;
  const interrupted = vi.spyOn(fs, 'copyFileSync').mockImplementation((source, target, flags) => {
    if (source === getWorkerConfigPath()) throw new Error('disk full');
    return copy(source, target, flags);
  });
  expect(() => retireWorkerEnrollment('home', 'old-device')).toThrow('disk full');
  interrupted.mockRestore();
  fs.writeFileSync(eventJournalPath('home'), 'newer events\n');
  expect(() => retireWorkerEnrollment('home', 'old-device')).toThrow(/saved work changed/);
  expect(fs.readFileSync(eventJournalPath('home'), 'utf8')).toBe('newer events\n');
  expect(fs.readFileSync(path.join(archives()[0], 'events.jsonl'), 'utf8')).toBe('original home.jsonl\n');
  expect(fs.existsSync(getWorkerConfigPath())).toBe(true);
});
