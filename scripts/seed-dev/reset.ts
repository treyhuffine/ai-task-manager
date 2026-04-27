#!/usr/bin/env tsx
/**
 * `pnpm dev:reset` — wipe the dev data root.
 *
 * Refuses to wipe if the dev root resolves to the same path as the prod
 * root (would only happen if paths.ts is misconfigured). Doesn't reseed.
 * For wipe + bootstrap + seed, use `pnpm dev:reseed`.
 */
import fs from 'node:fs';
import pc from 'picocolors';

import { getAppRoot, getDevAppRoot } from '../../src/lib/config/paths';

const devRoot = getDevAppRoot();
const prodRoot = getAppRoot();

if (devRoot === prodRoot) {
  console.error(pc.red(`Refusing to wipe: dev root resolves to the same path as prod (${devRoot}).`));
  console.error(pc.dim(`Check getAppRoot() / getDevAppRoot() in src/lib/config/paths.ts.`));
  process.exit(1);
}

if (!fs.existsSync(devRoot)) {
  console.log(pc.dim(`Dev root ${devRoot} does not exist — nothing to remove.`));
  process.exit(0);
}

console.log(pc.yellow(`Removing ${devRoot}…`));
fs.rmSync(devRoot, { recursive: true, force: true });
console.log(pc.green(`✓ wiped`));
