#!/usr/bin/env tsx
/**
 * Level 1 smoke test — mechanical bootstrap.
 *
 * Wipes an isolated test data root, runs the bootstrap steps in-process
 * (auth, skill install, DB init), and asserts the filesystem ended up right:
 *   - CLAUDE.md written at the app root
 *   - every shipped skill symlinked into .claude/skills/ and .agents/skills/
 *   - data.db created at the app root on first DB touch (no brain/ subfolder)
 *   - .config/config.json populated with a local token
 *
 * Paths come from the same helpers the app uses (src/lib/config/paths.ts) and
 * the skill list from `shippedSkillNames()`, so a layout change can't leave
 * this checking an old one.
 *
 * Deliberately skips booting the Next.js dev server — that would collide with
 * your main dev server's `.next/dev/lock` and doesn't add coverage at this
 * level. See scripts/smoke-orchestrator-agent.ts for the full-server path.
 *
 * Exit codes: 0 = pass, 1 = any assertion failed.
 *
 * Usage:
 *   pnpm smoke
 *   RI_ROOT=~/my-custom-test pnpm smoke   # override the test root
 */

import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';

import { APP_ROOT_ENV, getConfigPath, getDbPath, getTestAppRoot } from '../src/lib/config/paths';
import { shippedSkillNames } from '../src/lib/agent-skills/shipped';

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

  // Global skills are the user's own choice, so the smoke only checks it
  // didn't change them.
  const globalSkillDirs = shippedSkillNames().map((name) => path.join(process.env.HOME ?? '', '.claude', 'skills', name));
  const globalBefore = globalSkillDirs.map((p) => fs.existsSync(p));

  // Bootstrap in-process. Order matches `ri start --dev`:
  //   ensureLocalToken → ensureAppRoot (writes CLAUDE.md, config.json)
  //   installWorkspaceSkills → symlinks
  //   getDb → data.db
  console.log(pc.dim(`  bootstrapping…`));
  const { ensureLocalToken } = await import('../src/lib/auth/bootstrap');
  ensureLocalToken();

  const { installWorkspaceSkills } = await import('../src/cli/commands/skills');
  const installResult = await installWorkspaceSkills();
  console.log(pc.dim(`  skills: installed=${installResult.installed} skipped=${installResult.skipped}`));

  const { getDb, resetDb } = await import('../src/lib/db');
  getDb(); // creates data.db + runs migrations
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
      name: 'config.json written to .config/',
      run: () => fs.existsSync(getConfigPath()),
      detail: getConfigPath(),
    },
    {
      name: 'config.json contains a localToken',
      run: () => {
        const cfg = JSON.parse(fs.readFileSync(getConfigPath(), 'utf8')) as {
          localToken?: string;
        };
        return typeof cfg.localToken === 'string' && cfg.localToken.length > 0;
      },
    },
    {
      name: 'data.db created at the app root',
      run: () => getDbPath() === path.join(TEST_ROOT, 'data.db') && fs.existsSync(getDbPath()),
    },
    {
      name: 'no brain/ subfolder (content lives at the home root)',
      run: () => !fs.existsSync(path.join(TEST_ROOT, 'brain')),
    },
    ...shippedSkillNames().flatMap((name): Check[] => [
      ...(['.claude', '.agents'] as const).map((dir) => ({
        name: `${name} symlinked into ${dir}/skills/`,
        run: () => {
          const p = path.join(TEST_ROOT, dir, 'skills', name);
          return fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink();
        },
      })),
      {
        name: `${name} resolves to a SKILL.md named ${name}`,
        run: () => {
          const linked = fs.realpathSync(path.join(TEST_ROOT, '.claude', 'skills', name));
          const md = fs.readFileSync(path.join(linked, 'SKILL.md'), 'utf8');
          return new RegExp(`^name: ${name}$`, 'm').test(md);
        },
      },
    ]),
    {
      name: 'Global ~/.claude/skills/ left as it was',
      run: () => globalSkillDirs.every((p, i) => fs.existsSync(p) === globalBefore[i]),
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
