/**
 * Bring a retired home's chats into this one (src/lib/home/import-records.ts,
 * docs/homes-spec.md §10.2, P5.1). Reads the source, writes only this root.
 *
 *   pnpm iso <dest-root> -- pnpm tsx scripts/import-home.ts <source> --computer <name> [--map <sourceAgentId>=<destAgentId>]... [--apply]
 *
 * <source> is a data root or a `home-backup.ts backup` of one. --computer is
 * the computer that home ran on (its chats and their work belong to it here).
 * Without --apply it only says what it would do. The destination home must be
 * stopped: this refuses while anything else has its database open.
 */

import os from 'node:os';
import path from 'node:path';
import { getDbPath } from '../src/lib/config/paths';
import { exclusiveDatabaseAccess } from '../src/lib/service/maintenance';
import { applyHomeImport, describeHomeImport, HomeImportError, planHomeImport } from '../src/lib/home/import-records';

function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return path.resolve(p);
}

function usage(): never {
  console.error('usage: pnpm iso <dest-root> -- pnpm tsx scripts/import-home.ts <source> --computer <name> [--map <sourceAgentId>=<destAgentId>]... [--apply]');
  process.exit(2);
}

let source: string | undefined;
let computerName: string | undefined;
let apply = false;
const agentMap: Record<string, string> = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]!;
  if (arg === '--computer') computerName = argv[++i] ?? usage();
  else if (arg === '--apply') apply = true;
  else if (arg === '--map') {
    const [from, to] = (argv[++i] ?? '').split('=');
    if (!from || !to) usage();
    agentMap[from] = to;
  } else if (!source) source = expandHome(arg);
  else usage();
}
if (!source || !computerName) usage();

// Nothing else may have this database open: a running home would write
// beside the import.
try {
  exclusiveDatabaseAccess(getDbPath())();
} catch {
  console.error(`Something has ${getDbPath()} open. Stop that home, then import.`);
  process.exit(1);
}

try {
  const options = { sourceRoot: source, computerName, agentMap };
  if (!apply) {
    const plan = planHomeImport(options);
    console.log(describeHomeImport(plan));
    console.log(plan.problems.length ? '\nFix the problems above first.' : '\nRun again with --apply to import.');
    process.exit(plan.problems.length ? 1 : 0);
  }
  const started = Date.now();
  const result = applyHomeImport(options);
  console.log(describeHomeImport(result, { applied: true }));
  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s. What came from where: ${result.manifestPath}`);
} catch (err) {
  if (err instanceof HomeImportError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
