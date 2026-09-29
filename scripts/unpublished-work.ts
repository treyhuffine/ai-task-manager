/**
 * Work that exists only on this computer, before retiring its home
 * (src/lib/home/unpublished-work.ts, P5.1). Read-only.
 *
 *   pnpm tsx scripts/unpublished-work.ts <root> [--json <out-file>]
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describeUnpublishedWork, unpublishedWork } from '../src/lib/home/unpublished-work';

const expandHome = (p: string) => (p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : path.resolve(p));
const argv = process.argv.slice(2);
const root = argv[0] ? expandHome(argv[0]) : null;
const jsonAt = argv.indexOf('--json');
const jsonOut = jsonAt >= 0 && argv[jsonAt + 1] ? expandHome(argv[jsonAt + 1]!) : null;
if (!root || !fs.existsSync(path.join(root, 'data.db'))) {
  console.error('usage: pnpm tsx scripts/unpublished-work.ts <root> [--json <out-file>]');
  process.exit(2);
}
const report = unpublishedWork(root);
console.log(describeUnpublishedWork(report));
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
