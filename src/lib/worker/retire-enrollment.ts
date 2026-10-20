/** Keep a removed device's enrollment and journals out of its replacement's
 * replay paths. The caller must hold the worker lock and verify removal at
 * the Home before calling. Native history and process cleanup records stay. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getWorkDir, getWorkerConfigPath } from '@/lib/config/paths';
import { atomicWriteFile } from '@/lib/config/atomic-write';
import { commandJournalPath } from './command-journal';
import { eventJournalPath } from './event-journal';

export function retireWorkerEnrollment(homeId: string, deviceId: string): void {
  const identity = createHash('sha256').update(JSON.stringify([homeId, deviceId])).digest('hex');
  const archive = path.join(/* turbopackIgnore: true */ getWorkDir(), 'retired-workers', identity);
  const events = eventJournalPath(homeId);
  const commands = commandJournalPath(homeId);
  const files = [
    [events, 'events.jsonl'],
    [`${events}.format`, 'events.jsonl.format'],
    [events.replace(/\.jsonl$/, '.acked'), 'events.acked'],
    [commands, 'commands.jsonl'],
    [`${commands}.format`, 'commands.jsonl.format'],
    [getWorkerConfigPath(), 'worker.json'],
  ].filter(([file]) => fs.existsSync(file));
  if (!files.length) return;
  fs.mkdirSync(archive, { recursive: true, mode: 0o700 });
  const manifest = path.join(/* turbopackIgnore: true */ archive, 'identity.json');
  if (!fs.existsSync(manifest)) atomicWriteFile(manifest, JSON.stringify({ version: 1, homeId, deviceId }) + '\n');
  // Copy and flush everything before removing any live path. An interrupted
  // attempt can retry the same archive, including across config/work volumes.
  for (const [source, name] of files) {
    const target = path.join(/* turbopackIgnore: true */ archive, name);
    if (fs.existsSync(target)) {
      if (!fs.readFileSync(source).equals(fs.readFileSync(target))) throw new Error('The removed device’s saved work changed during reconnection. Its files were preserved. Review local recovery before retrying.');
    } else {
      const tmp = `${target}.${process.pid}.tmp`;
      try {
        fs.copyFileSync(source, tmp);
        fs.chmodSync(tmp, 0o600);
        const fd = fs.openSync(tmp, 'r');
        try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(tmp, target);
      } finally { fs.rmSync(tmp, { force: true }); }
    }
  }
  const directory = fs.openSync(archive, 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  for (const [source] of files) fs.unlinkSync(source);
}
