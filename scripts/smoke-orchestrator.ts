#!/usr/bin/env tsx
/**
 * Level 1 smoke test — mechanical bootstrap.
 *
 * Wipes an isolated test data root, runs the bootstrap steps in-process
 * (auth, skill install, DB init), and asserts the filesystem ended up right:
 *   - CLAUDE.md written at the app root
 *   - orchestrator skill symlinked into .claude/skills/ and .agents/skills/
 *   - brain/data.db created on first DB touch
 *   - config.json populated with a local token
 *
 * Deliberately skips booting the Next.js dev server — that would collide with
 * your main dev server's `.next/dev/lock` and doesn't add coverage at this
 * level. See scripts/smoke-orchestrator-agent.ts for the full-server path.
 *
 * Exit codes: 0 = pass, 1 = any assertion failed.
 *
 * Usage:
 *   pnpm smoke
 *   FLOW_ROOT=~/my-custom-test pnpm smoke   # override the test root
 */

import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';

import { APP_ROOT_ENV, getTestAppRoot } from '../src/lib/config/paths';

const TEST_ROOT = process.env[APP_ROOT_ENV] ?? getTestAppRoot();
process.env[APP_ROOT_ENV] = TEST_ROOT;

interface Check {
  name: string;
  run: () => boolean | Promise<boolean>;
  detail?: string;
}

async function main() {
  console.log(pc.bold(`Level 1 smoke: mechanical bootstrap`));
  console.log(pc.dim(`  data root: ${TEST_ROOT}`));

  console.log(pc.dim(`  wiping…`));
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });

  // Bootstrap in-process. Order matches `flow start --dev`:
  //   ensureLocalToken → ensureAppRoot (writes CLAUDE.md, config.json)
  //   installWorkspaceSkills → symlinks
  //   getDb → brain/data.db
  console.log(pc.dim(`  bootstrapping…`));
  const { ensureLocalToken } = await import('../src/lib/auth/bootstrap');
  ensureLocalToken();

  const { installWorkspaceSkills } = await import('../src/cli/commands/skills');
  const installResult = await installWorkspaceSkills();
  console.log(pc.dim(`  skills: installed=${installResult.installed} skipped=${installResult.skipped}`));

  const { getDb, resetDb } = await import('../src/lib/db');
  getDb(); // creates brain/data.db + runs migrations
  resetDb(); // release handle so file checks are clean

  const checks: Check[] = [
    {
      name: 'App root exists',
      run: () => fs.existsSync(TEST_ROOT),
      detail: TEST_ROOT,
    },
    {
      name: 'CLAUDE.md written to app root',
      run: () => fs.existsSync(path.join(TEST_ROOT, 'CLAUDE.md')),
    },
    {
      name: 'config.json written to app root',
      run: () => fs.existsSync(path.join(TEST_ROOT, 'config.json')),
    },
    {
      name: 'config.json contains a localToken',
      run: () => {
        const cfg = JSON.parse(fs.readFileSync(path.join(TEST_ROOT, 'config.json'), 'utf8')) as {
          localToken?: string;
        };
        return typeof cfg.localToken === 'string' && cfg.localToken.length > 0;
      },
    },
    {
      name: 'brain/ directory created',
      run: () => fs.statSync(path.join(TEST_ROOT, 'brain')).isDirectory(),
    },
    {
      name: 'brain/data.db exists',
      run: () => fs.existsSync(path.join(TEST_ROOT, 'brain', 'data.db')),
    },
    {
      name: 'orchestrator skill symlinked into .claude/skills/',
      run: () => {
        const p = path.join(TEST_ROOT, '.claude', 'skills', 'orchestrator');
        return fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink();
      },
    },
    {
      name: 'orchestrator skill symlinked into .agents/skills/',
      run: () => {
        const p = path.join(TEST_ROOT, '.agents', 'skills', 'orchestrator');
        return fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink();
      },
    },
    {
      name: 'skill symlinks resolve to a real SKILL.md',
      run: () => {
        const linked = fs.realpathSync(
          path.join(TEST_ROOT, '.claude', 'skills', 'orchestrator'),
        );
        return fs.existsSync(path.join(linked, 'SKILL.md'));
      },
    },
    {
      name: 'Global ~/.claude/skills/orchestrator was NOT created',
      run: () =>
        !fs.existsSync(path.join(process.env.HOME ?? '', '.claude', 'skills', 'orchestrator')),
    },
  ];

  let passed = 0;
  let failed = 0;
  for (const c of checks) {
    let ok = false;
    let err: string | undefined;
    try {
      ok = await c.run();
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    if (ok) {
      console.log(`  ${pc.green('✓')} ${c.name}${c.detail ? pc.dim(`  ${c.detail}`) : ''}`);
      passed++;
    } else {
      console.log(`  ${pc.red('✗')} ${c.name}${err ? pc.dim(`  ${err}`) : ''}`);
      failed++;
    }
  }

  console.log();
  if (failed === 0) {
    console.log(pc.green(pc.bold(`✓ all ${passed} checks passed`)));
    console.log(pc.dim(`  test root left at ${TEST_ROOT} for inspection`));
    console.log();
    console.log(pc.bold(`Next steps`));
    console.log(`  Level 2 (manual Claude session):`);
    console.log(pc.dim(`    cd ${TEST_ROOT}`));
    console.log(pc.dim(`    claude`));
    console.log(pc.dim(`    # try: "what am I working on?" or "add a task: test123"`));
    console.log();
    console.log(`  Level 3 (programmatic Claude):`);
    console.log(pc.dim(`    pnpm smoke:agent`));
    process.exit(0);
  } else {
    console.log(pc.red(pc.bold(`✗ ${failed} failed, ${passed} passed`)));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(pc.red(`smoke failed: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
