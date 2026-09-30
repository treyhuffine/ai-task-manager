/** Read-only preflight. Validation must never repair or compact a journal. */
import fs from 'node:fs';
import path from 'node:path';
import { getWorkDir } from '@/lib/config/paths';
import { CURRENT_COMPATIBILITY } from '@/lib/releases/compatibility';
export function assertWorkerJournalFormats(homeId: string): void {
  for (const [directory, formats] of [['commands', CURRENT_COMPATIBILITY.journal.commands], ['journal', CURRENT_COMPATIBILITY.journal.events]] as const) {
    const marker = path.join(getWorkDir(), directory, `${homeId}.jsonl.format`);
    if (!fs.existsSync(marker)) continue; // Unmarked legacy journals are format 1.
    const stored = fs.readFileSync(marker, 'utf8').trim();
    if (!/^\d+$/.test(stored) || !formats.read.includes(Number(stored))) throw new Error(`This installation cannot read the saved ${directory} format. Install a compatible Ri release. The journal was preserved.`);
  }
}
