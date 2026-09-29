/**
 * What one home has that another doesn't, before consolidating them
 * (docs/homes-spec.md §10.2, P5.1). Reads both, writes to neither.
 *
 *   pnpm tsx scripts/compare-homes.ts <a> <b> [--names Mini,Laptop] [--list 15] [--json <out-file>]
 *
 * Each of <a> and <b> is a data root or a backup of one (`home-backup.ts
 * backup`), which has a root's layout. A running home can be read in place.
 * B is the home being brought in: the listing names what B has that A
 * lacks, what B changed later, and what in B looks like something A already
 * has. The JSON has every record, for choosing what to import.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compareHomes, describeComparison } from '../src/lib/home/compare';

function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return path.resolve(p);
}

function usage(): never {
  console.error('usage: pnpm tsx scripts/compare-homes.ts <a> <b> [--names A,B] [--list N] [--json <out-file>]');
  process.exit(2);
}

const roots: string[] = [];
let names: { a: string; b: string } | undefined;
let list = 15;
let jsonOut: string | undefined;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]!;
  if (arg === '--names') {
    const [a, b] = (argv[++i] ?? '').split(',');
    if (!a || !b) usage();
    names = { a, b };
  } else if (arg === '--list') list = Number(argv[++i] ?? usage());
  else if (arg === '--json') jsonOut = expandHome(argv[++i] ?? usage());
  else roots.push(expandHome(arg));
}
if (roots.length !== 2) usage();
const [a, b] = roots as [string, string];
for (const root of roots) {
  if (!fs.existsSync(path.join(root, 'data.db'))) {
    console.error(`${root} has no data.db. Give a data root, or a backup of one.`);
    process.exit(1);
  }
  if (jsonOut && (jsonOut === root || jsonOut.startsWith(root + path.sep))) {
    console.error('Write the report outside both homes.');
    process.exit(1);
  }
}

const comparison = compareHomes(a, b);
console.log(describeComparison(comparison, { names, list }));
if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify(comparison, null, 2) + '\n', { mode: 0o600 });
  console.error(`\nEvery record is in ${jsonOut}`);
}
