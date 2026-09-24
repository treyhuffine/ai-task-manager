/**
 * Preview what `ri setup adopt` would write for a home, read-only.
 *
 *   pnpm tsx scripts/plan-adoption.ts <root>
 *
 * Reads the root's database without opening it through the app (no
 * migrations, nothing created beside it) and checks each agent folder and
 * any setup file already in it. Writes nothing anywhere, so it can preview a
 * production cutover (docs/homes-spec.md §10.1, §10.4).
 */

import os from 'node:os';
import path from 'node:path';
import { planAdoption, type AdoptionReference } from '../src/lib/setups/adopt';
import { withSourceDatabase } from '../src/lib/home/source-db';
import { printAdoptionPlan } from '../src/cli/commands/setup';

function expandHome(p: string): string {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : path.resolve(p);
}

const rootArg = process.argv[2];
if (!rootArg) {
  console.error('usage: pnpm tsx scripts/plan-adoption.ts <root>');
  process.exit(2);
}
const root = expandHome(rootArg);

withSourceDatabase(path.join(root, 'data.db'), (db) => {
  const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));
  const homeId = tables.has('home')
    ? ((db.prepare('SELECT id FROM home').get() as { id: string } | undefined)?.id ?? '<new home id>')
    : '<new home id>';
  const agents = db
    .prepare("SELECT id, name, cwd FROM workspaces WHERE status = 'active' ORDER BY position")
    .all() as { id: string; name: string; cwd: string }[];
  const refs = db
    .prepare("SELECT id, workspace_id, alias, path, target_workspace_id, position, created_at FROM reference_folders WHERE status = 'active'")
    .all() as { workspace_id: string | null; alias: string; path: string | null; target_workspace_id: string | null }[];
  const referencesFor = (agentId: string): AdoptionReference[] => {
    const own = refs.filter((r) => r.workspace_id === agentId);
    const ownAliases = new Set(own.map((r) => r.alias));
    return [...own, ...refs.filter((r) => r.workspace_id === null && !ownAliases.has(r.alias))].map((r) => ({
      alias: r.alias,
      path: r.path,
      targetWorkspaceId: r.target_workspace_id,
    }));
  };
  const plan = planAdoption({ homeId, agents, referencesFor });
  console.log(`Adoption plan for ${root} (${agents.length} active agents)\n`);
  printAdoptionPlan(plan, new Map(agents.map((a) => [a.id, a.name])));
});
