#!/usr/bin/env tsx
/**
 * `pnpm dev:reseed` — wipe data + reseed, preserving auth/identity state.
 *
 * Snapshots `config.json` and the `api_keys` table before wiping, then
 * restores them after the fresh DB is built. End result: synthetic dataset
 * is rebuilt, but your local token, tunnel URL, voice/onboarded prefs, and
 * paired devices all survive — so you don't re-pair your phone or re-walk
 * onboarding every reseed.
 *
 * For a true factory reset: `rm -rf ~/flow-dev && pnpm dev:reseed`.
 */
import fs from 'node:fs';
import pc from 'picocolors';

import { APP_ROOT_ENV, getAppRoot, getDevAppRoot, getDbPath } from '../../src/lib/config/paths';

const devRoot = getDevAppRoot();
const prodRoot = getAppRoot();

if (devRoot === prodRoot) {
  console.error(pc.red(`Refusing: dev root resolves to the same path as prod (${devRoot}).`));
  console.error(pc.dim(`Check getAppRoot() / getDevAppRoot() in src/lib/config/paths.ts.`));
  process.exit(1);
}

process.env[APP_ROOT_ENV] = devRoot;

async function main() {
  const { readAuthConfig, writeAuthConfig } = await import('../../src/lib/auth/config-file');
  const { apiKeys } = await import('../../src/lib/db/schema');

  // ── Snapshot ──────────────────────────────────────────────────────────
  const savedConfig = fs.existsSync(devRoot) ? readAuthConfig() : null;
  let savedApiKeys: (typeof apiKeys.$inferSelect)[] = [];

  if (fs.existsSync(getDbPath())) {
    const { getDb, resetDb } = await import('../../src/lib/db');
    savedApiKeys = getDb().select().from(apiKeys).all();
    resetDb(); // close handle so the file can be removed
  }

  // ── Wipe ──────────────────────────────────────────────────────────────
  if (fs.existsSync(devRoot)) {
    console.log(pc.yellow(`Removing ${devRoot}…`));
    fs.rmSync(devRoot, { recursive: true, force: true });
    console.log(pc.green(`✓ wiped`));
    if (savedConfig || savedApiKeys.length > 0) {
      const parts: string[] = [];
      if (savedConfig) parts.push('config');
      if (savedApiKeys.length > 0) parts.push(`${savedApiKeys.length} api key${savedApiKeys.length === 1 ? '' : 's'}`);
      console.log(pc.dim(`  preserving: ${parts.join(', ')}`));
    }
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────
  console.log(pc.dim(`Bootstrapping…`));

  // Restore config.json before ensureLocalToken so it sees the prior token.
  if (savedConfig) writeAuthConfig(savedConfig);

  // Open the fresh DB (creates schema), then restore api_keys rows so the
  // preserved local token's hash matches an existing row — ensureLocalToken
  // will then no-op instead of rotating.
  const { getDb } = await import('../../src/lib/db');
  const db = getDb();
  if (savedApiKeys.length > 0) {
    db.insert(apiKeys).values(savedApiKeys).run();
  }

  const { ensureLocalToken } = await import('../../src/lib/auth/bootstrap');
  ensureLocalToken();

  const { installWorkspaceSkills } = await import('../../src/cli/commands/skills');
  await installWorkspaceSkills();

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
