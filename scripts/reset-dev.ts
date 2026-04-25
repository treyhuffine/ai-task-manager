#!/usr/bin/env tsx
/**
 * `pnpm reset:dev` — wipe the dev data root.
 *
 * Use when you want to start dev mode from a clean slate. Writes nothing;
 * just removes `~/.<app-short-id>-dev/` so the next `pnpm dev` or `flow
 * start --dev` bootstraps a fresh one.
 *
 * Refuses to touch the prod root (whatever `getAppRoot()` resolves to with
 * no `FLOW_ROOT` override). The dev root is a dedicated isolated location;
 * there's no reason this script should ever target prod, so it guards.
 *
 * No equivalent `reset:prod` script is provided — wiping prod should always
 * require an intentional `rm -rf <path>` typed by a human who knows what
 * they're doing.
 */

import fs from 'node:fs';
import pc from 'picocolors';

import { getAppRoot, getDevAppRoot } from '../src/lib/config/paths';

const devRoot = getDevAppRoot();
const prodRoot = getAppRoot(); // before any FLOW_ROOT override

if (devRoot === prodRoot) {
  console.error(pc.red(`Refusing to wipe: dev root resolves to the same path as prod (${devRoot}).`));
  console.error(pc.dim(`This shouldn't happen — check getAppRoot() / getDevAppRoot() in src/lib/config/paths.ts.`));
  process.exit(1);
}

if (!fs.existsSync(devRoot)) {
  console.log(pc.dim(`Dev root ${devRoot} does not exist — nothing to remove.`));
  process.exit(0);
}

console.log(pc.yellow(`Removing ${devRoot}…`));
fs.rmSync(devRoot, { recursive: true, force: true });
console.log(pc.green(`✓ wiped`));
console.log(pc.dim(`Next \`pnpm dev\` will bootstrap a fresh data root.`));
