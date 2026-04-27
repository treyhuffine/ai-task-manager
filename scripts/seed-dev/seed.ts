#!/usr/bin/env tsx
/**
 * `pnpm dev:seed` — seed the dev data root with the shared synthetic
 * dataset (areas/tasks/notes from this directory).
 *
 * Goes through `queries.ts` so embeddings + the markdown mirror stay in
 * sync, just like at runtime. Areas are deduped by name (re-runnable);
 * tasks and notes are not — pair with `dev:reset` for a clean slate.
 *
 * Defaults `FLOW_ROOT` to the dev root if not set, so this is safe to run
 * casually without env management.
 */
import { fileURLToPath } from 'node:url';

import pc from 'picocolors';

import { APP_ROOT_ENV, getDevAppRoot } from '../../src/lib/config/paths';

export async function runSeed() {
  const root = process.env[APP_ROOT_ENV];
  console.log(pc.bold(`Seeding ${root}…`));

  const { areas: seedAreas } = await import('./areas');
  const { tasks: seedTasks } = await import('./tasks');
  const { notes: seedNotes } = await import('./notes');
  const queries = await import('../../src/lib/db/queries');

  const areaIdByName = new Map<string, string>();
  for (const existing of queries.listAreas()) {
    areaIdByName.set(existing.name, existing.id);
  }

  let createdAreas = 0;
  for (const a of seedAreas) {
    if (areaIdByName.has(a.name)) continue;
    const created = queries.createArea(a);
    areaIdByName.set(created.name, created.id);
    createdAreas++;
  }
  console.log(pc.green(`  ✓ ${createdAreas} areas`));

  const taskIdByTitle = new Map<string, string>();
  let createdTasks = 0;
  for (const t of seedTasks) {
    const { area_name, parent_title, ...rest } = t;
    const area_id = area_name ? areaIdByName.get(area_name) ?? null : null;
    const parent_id = parent_title ? taskIdByTitle.get(parent_title) ?? null : null;
    const created = queries.createTask({
      ...rest,
      raw_input: rest.raw_input ?? rest.title,
      area_id,
      parent_id,
    });
    taskIdByTitle.set(created.title, created.id);
    createdTasks++;
  }
  console.log(pc.green(`  ✓ ${createdTasks} tasks`));

  let createdNotes = 0;
  for (const n of seedNotes) {
    const { area_name, task_title, ...rest } = n;
    const area_id = area_name ? areaIdByName.get(area_name) ?? null : null;
    const task_id = task_title ? taskIdByTitle.get(task_title) ?? null : null;
    queries.createNote({ ...rest, area_id, task_id });
    createdNotes++;
  }
  console.log(pc.green(`  ✓ ${createdNotes} notes`));

  // Mark onboarded so /welcome doesn't intercept the dashboard. Use dev:reset
  // (no reseed) to test the welcome wizard from scratch.
  queries.updateUserState({
    name: 'Dev User',
    description: 'Building the AI assistant. Multi-business operator with a full life.',
    onboarded_at: new Date().toISOString(),
  });
  console.log(pc.green(`  ✓ user state (onboarded)`));
}

async function main() {
  if (!process.env[APP_ROOT_ENV]) {
    process.env[APP_ROOT_ENV] = getDevAppRoot();
  }
  await runSeed();
  console.log();
  console.log(pc.dim(`run \`pnpm dev\` to start`));
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((e) => {
    console.error(pc.red(e instanceof Error ? e.message : String(e)));
    process.exit(1);
  });
}
