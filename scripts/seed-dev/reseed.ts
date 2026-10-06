#!/usr/bin/env tsx
/**
 * `pnpm dev:reseed`: rebuild the dev home (`~/ri-dev`) from the synthetic
 * dataset, keeping your auth so paired browsers and devices still work.
 *
 * 1. Refuses while anything has the dev home open (`pnpm dev`, the desktop
 *    app in development, `ri start --dev`), and holds the home's owner lock
 *    until it's done so none can start mid-seed.
 * 2. Snapshots `config.json` and the `api_keys` table.
 * 3. Moves the current dev home to `~/ri-dev.previous` (replacing an older
 *    one), so one reseed can always be undone by moving it back.
 * 4. Builds a fresh database, restores the config and keys, seeds
 *    (`seed.ts`), and computes search embeddings when an OpenAI key is
 *    available (from the environment or `.env.local`).
 *
 * For a true factory reset: `rm -rf ~/ri-dev && pnpm dev:reseed`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';

import { APP_ROOT_ENV, getDbPath, getDevAppRoot, getProductionAppRoot } from '../../src/lib/config/paths';

const devRoot = getDevAppRoot();
const previous = `${devRoot}.previous`;

if (path.resolve(devRoot) === path.resolve(getProductionAppRoot())) {
  console.error(pc.red(`Refusing: dev root resolves to the production home (${devRoot}).`));
  process.exit(1);
}

// Everything below acts on the dev home, whatever the shell had set.
for (const name of ['RI_DB_PATH', 'RI_CONFIG_DIR', 'RI_WORK_DIR']) delete process.env[name];
process.env[APP_ROOT_ENV] = devRoot;

/** OPENAI_API_KEY from the environment, else from the checkout's .env.local. */
function openAiKey(): string | null {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const line = fs.readFileSync('.env.local', 'utf8').split('\n').find((l) => /^\s*OPENAI_API_KEY\s*=/.test(l));
    return line ? line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '') || null : null;
  } catch {
    return null;
  }
}

async function main() {
  const { readAuthConfig, writeAuthConfig } = await import('../../src/lib/auth/config-file');
  const { apiKeys, devices } = await import('../../src/lib/db/schema');
  const { hashToken } = await import('../../src/lib/auth/tokens');
  const { acquireServiceOwner } = await import('../../src/lib/service/owner');

  // ── Hold the home ─────────────────────────────────────────────────────
  let releaseOwner: (() => void) | null = null;
  if (fs.existsSync(devRoot)) {
    try {
      releaseOwner = acquireServiceOwner();
    } catch {
      console.error(pc.red(`${devRoot} is open in another launcher (pnpm dev, the desktop app, or ri start --dev).`));
      console.error(pc.dim('Stop it first, then reseed.'));
      process.exit(1);
    }
  }

  // ── Snapshot ──────────────────────────────────────────────────────────
  const savedConfig = fs.existsSync(devRoot) ? readAuthConfig() : null;
  let savedApiKeys: (typeof apiKeys.$inferSelect)[] = [];
  if (fs.existsSync(getDbPath())) {
    const { getDb, resetDb } = await import('../../src/lib/db');
    savedApiKeys = getDb().select().from(apiKeys).all();
    resetDb(); // close the handle before the folder moves
  }

  // ── Set the old home aside ────────────────────────────────────────────
  if (fs.existsSync(devRoot)) {
    releaseOwner?.();
    releaseOwner = null;
    fs.rmSync(previous, { recursive: true, force: true });
    fs.renameSync(devRoot, previous);
    console.log(pc.yellow(`Moved the old dev home to ${previous}`));
    const parts: string[] = [];
    if (savedConfig) parts.push('config');
    if (savedApiKeys.length > 0) parts.push(`${savedApiKeys.length} api key${savedApiKeys.length === 1 ? '' : 's'}`);
    if (parts.length) console.log(pc.dim(`  keeping: ${parts.join(', ')}`));
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────
  console.log(pc.dim('Bootstrapping…'));
  fs.mkdirSync(devRoot, { recursive: true, mode: 0o700 });
  releaseOwner = acquireServiceOwner();
  try {
    // Restore config.json before ensureLocalToken so it sees the prior token.
    if (savedConfig) writeAuthConfig(savedConfig);

    // Open the fresh DB (creates schema), then restore api_keys rows so the
    // preserved local token's hash matches an existing row, and
    // ensureLocalToken no-ops instead of rotating. Each paired key gets a
    // device of its own again, as the homes migration gives keys from before
    // devices. The home's own key waits for the home's identity, which gives
    // it the home's device. A worker key went with its device, and isn't kept.
    const { getDb } = await import('../../src/lib/db');
    const db = getDb();
    const hostHash = savedConfig?.localToken ? hashToken(savedConfig.localToken) : null;
    for (const key of savedApiKeys) {
      if (key.role === 'worker') continue;
      const own = key.hash !== hostHash;
      if (own) {
        db.insert(devices)
          .values({ id: key.id, name: key.name, kind: 'other', status: key.revokedAt ? 'revoked' : 'active', revokedAt: key.revokedAt, createdAt: key.createdAt, updatedAt: key.updatedAt })
          .run();
      }
      db.insert(apiKeys).values({ ...key, deviceId: own ? key.id : null }).run();
    }

    const { ensureLocalToken } = await import('../../src/lib/auth/bootstrap');
    ensureLocalToken();

    const { installWorkspaceSkills } = await import('../../src/cli/commands/skills');
    await installWorkspaceSkills();
    console.log(pc.green('✓ bootstrapped'));

    const { runSeed } = await import('./seed');
    await runSeed();
  } finally {
    releaseOwner();
  }

  // ── Search embeddings ─────────────────────────────────────────────────
  const key = openAiKey();
  if (key) {
    console.log(pc.dim('Computing search embeddings…'));
    const tsx = path.resolve('node_modules/.bin/tsx');
    const res = spawnSync(tsx, ['src/lib/embeddings/backfill.ts'], {
      env: { ...process.env, OPENAI_API_KEY: key, [APP_ROOT_ENV]: devRoot },
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    if (res.status === 0) console.log(pc.green('✓ embeddings'));
    else console.log(pc.yellow(`Embeddings skipped (search falls back to text): ${(res.stderr || res.stdout).trim().split('\n').at(-1)}`));
  } else {
    console.log(pc.dim('No OPENAI_API_KEY, so no embeddings. Search falls back to text.'));
  }

  console.log();
  console.log(pc.dim(`Run \`pnpm dev\` to start. The old home is in ${previous}.`));
}

main().catch((e) => {
  console.error(pc.red(e instanceof Error ? e.stack ?? e.message : String(e)));
  process.exit(1);
});
