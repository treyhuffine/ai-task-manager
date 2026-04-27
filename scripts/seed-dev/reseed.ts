#!/usr/bin/env tsx
/**
 * `pnpm dev:reseed` — wipe + bootstrap + seed in one go.
 *
 * The muscle-memory command: gives you a fresh `~/.flow-dev` with the
 * synthetic dataset in seconds. Bootstrap chain mirrors `flow start --dev`
 * (auth token, skill symlinks, db migrations) so the resulting root is
 * indistinguishable from one created by a real dev server boot.
 */
import fs from 'node:fs';
import pc from 'picocolors';

import { APP_ROOT_ENV, getAppRoot, getDevAppRoot } from '../../src/lib/config/paths';

const devRoot = getDevAppRoot();
const prodRoot = getAppRoot();

if (devRoot === prodRoot) {
  console.error(pc.red(`Refusing: dev root resolves to the same path as prod (${devRoot}).`));
  console.error(pc.dim(`Check getAppRoot() / getDevAppRoot() in src/lib/config/paths.ts.`));
  process.exit(1);
}

process.env[APP_ROOT_ENV] = devRoot;

async function main() {
  if (fs.existsSync(devRoot)) {
    console.log(pc.yellow(`Removing ${devRoot}…`));
    fs.rmSync(devRoot, { recursive: true, force: true });
    console.log(pc.green(`✓ wiped`));
  }

  console.log(pc.dim(`Bootstrapping…`));
  const { ensureLocalToken } = await import('../../src/lib/auth/bootstrap');
  ensureLocalToken();

  const { installWorkspaceSkills } = await import('../../src/cli/commands/skills');
  await installWorkspaceSkills();

  const { getDb } = await import('../../src/lib/db');
  getDb();
  console.log(pc.green(`✓ bootstrapped`));

  const { runSeed } = await import('./seed');
  await runSeed();

  console.log();
  console.log(pc.dim(`run \`pnpm dev\` to start`));
}

main().catch((e) => {
  console.error(pc.red(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
