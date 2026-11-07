/**
 * The CLI's one-line update notices (docs/always-on-spec.md 7.1), like Claude
 * Code's: one line when an update is waiting, and one after a Home has moved. Each
 * says its piece once and stays quiet after that.
 */
import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from '@/lib/config/atomic-file';
import { getRuntimeInstallDir } from './paths';
import { updateWaitingText } from './update-presentation';
import type { UpdateRecord } from './update';

export function updateNotice(update: UpdateRecord, rootLabel: string, seen: string | null): { line: string; mark: string } | null {
  if (update.phase === 'committed' && update.committedAt && update.release) {
    const mark = `moved:${update.committedAt}`;
    return mark === seen ? null : { mark, line: `Updated ${rootLabel} to ${update.release.version}` };
  }
  if (update.phase === 'waiting' && update.release) {
    const mark = `waiting:${update.release.runtime.id}`;
    return mark === seen ? null : { mark, line: `Ri ${update.release.version} is ready. ${updateWaitingText(update)}. To update now: ri update` };
  }
  return null;
}

const COMMANDS_WITH_THEIR_OWN_SAY = new Set(['update', 'status', 'start', 'stop', 'restart', 'logs', 'service', 'agent', 'doctor', 'acp', 'worker', 'mcp']);
/** Only to a person at a terminal, on stderr, after a command with nothing to say about updates. */
export function wantsUpdateNotice(command: string, stderrIsTerminal: boolean) {
  return stderrIsTerminal && !COMMANDS_WITH_THEIR_OWN_SAY.has(command);
}

export function readNoticeMark() {
  try { return fs.readFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ getRuntimeInstallDir(), 'update-notice'), 'utf8').trim(); }
  catch { return null; }
}
export function writeNoticeMark(mark: string) {
  try { atomicWriteFile(path.join(/* turbopackIgnore: true */ getRuntimeInstallDir(), 'update-notice'), `${mark}\n`); }
  catch { /* A notice said twice is better than a command that fails over one. */ }
}
