/**
 * `<cli> skills` — install, list, remove the skills this app ships.
 *
 * Skills live at <repo>/skills/*. Install uses agentex to symlink each skill dir
 * into both standard cross-agent discovery channels:
 *   ~/.agents/skills/<name>  (Codex, Cursor, Gemini, OpenCode, Pi)
 *   ~/.claude/skills/<name>  (Claude Code)
 *
 * Symlinks mean skill content tracks the source — upgrades pick up new
 * guidance automatically without a re-install.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pc from 'picocolors';
import { Command } from 'commander';
import { getAppRoot } from '@/lib/config/paths';
import { APP_SHORT_ID } from '@/constants/app';

// agentex is lazy-imported inside each action. Two reasons:
//   1. `@agentex/agent@0.0.6` ships only an `"import"` condition in its exports
//      (no `"default"` or `"require"`), so CJS resolvers — including tsx when
//      the consumer isn't `"type": "module"` — reject it at static import
//      time. Dynamic import() always uses the ESM resolver, matching "import".
//   2. The rest of the CLI has no business loading a cross-agent skill
//      manager just to run `<cli> start` or `<cli> doctor`.
async function loadAgentex() {
  return import('@agentex/agent');
}

// ──────────────────────────────────────────────────────────────────────
// Safety gate.
//
// While this is still new, `install` refuses to touch the user's global
// ~/.claude/skills/ and ~/.agents/skills/ unless this constant is flipped.
// Flip to true once you're comfortable with the skill content and ready to
// let this app's skills live alongside your other skill packs.
//
// `remove` and `list` always work — they're how you recover or inspect.
// ──────────────────────────────────────────────────────────────────────
const ALLOW_GLOBAL_INSTALL = false;

// The shipped skills live at <package-root>/skills/*. Walking up from the
// current file to find the nearest package.json handles every caller:
//   - Dev via tsx: source at src/cli/commands/skills.ts → repo root is 3 up
//   - Bundled via tsup: dist/cli/index.mjs → repo root is 2 up
//   - npm install: node_modules/<pkg>/dist/cli/index.mjs → pkg root is 2 up
// In every case, the package.json sits at the skills/ dir's sibling.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function findPackageRoot(startDir: string): string {
  let dir = startDir;
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error(`Could not find package.json walking up from ${startDir}`);
}
const SKILLS_ROOT = path.join(findPackageRoot(__dirname), 'skills');

// Skills that get installed to the user's agent homes. The contributor skill
// stays out of this list — it belongs in <repo>/.claude/skills/ as project
// local and shouldn't leak into other repos' sessions.
const SHIPPED_SKILLS = ['orchestrator'];

function skillDirs(): string[] {
  return SHIPPED_SKILLS.map((name) => path.join(SKILLS_ROOT, name));
}

/**
 * Install shipped skills into the app-root workspace — <app-root>/.claude/skills
 * and <app-root>/.agents/skills, where <app-root> resolves via getAppRoot().
 * Idempotent. Safe to call on every CLI boot; existing symlinks return
 * status='skipped', stale ones are flagged as conflicts (left for the user
 * to resolve).
 *
 * Called by the `start` CLI command as a best-effort step so an agent session
 * opened in the app data dir auto-discovers the orchestrator skill.
 */
export async function installWorkspaceSkills() {
  const { installSkills } = await loadAgentex();
  return installSkills(skillDirs(), {
    location: 'workspace',
    cwd: getAppRoot(),
  });
}

export function registerSkillsCommand(program: Command) {
  const skills = program
    .command('skills')
    .description('Install and manage the skills this app ships for agent sessions');

  skills
    .command('install')
    .description(
      'Symlink shipped skills into the app data dir (<app-root>/.claude/skills and <app-root>/.agents/skills). ' +
        'Pass --global to symlink into ~/.claude/skills/ and ~/.agents/skills/ (shared with other agents, gated).',
    )
    .option('--global', 'Install into the user-level ~/.claude/skills and ~/.agents/skills instead of the app data dir')
    .action(async (opts: { global?: boolean }) => {
      const { installSkills } = await loadAgentex();
      const isGlobal = !!opts.global;

      if (isGlobal && !ALLOW_GLOBAL_INSTALL) {
        console.error(
          pc.yellow(
            '--global is disabled. It would symlink into ~/.claude/skills/ and ~/.agents/skills/,\nshared with your other agents and skill packs.\n',
          ),
        );
        console.error(
          'To enable, flip ALLOW_GLOBAL_INSTALL to true in src/cli/commands/skills.ts and rebuild.',
        );
        console.error(pc.dim(`\nWould have symlinked:`));
        for (const dir of skillDirs()) console.error(pc.dim(`  ${dir}`));
        process.exit(1);
      }

      const result = isGlobal
        ? await installSkills(skillDirs(), { location: 'global' })
        : await installSkills(skillDirs(), { location: 'workspace', cwd: getAppRoot() });

      for (const e of result.entries) {
        const tag =
          e.status === 'created'
            ? pc.green('+')
            : e.status === 'skipped'
              ? pc.dim('·')
              : e.status === 'conflict'
                ? pc.yellow('!')
                : pc.red('×');
        console.log(`  ${tag} ${e.target}/${e.skillName}  ${pc.dim(e.targetPath)}`);
        if (e.error) console.log(`      ${pc.red(e.error)}`);
      }
      console.log(
        pc.dim(
          `\ninstalled=${result.installed} skipped=${result.skipped} conflicts=${result.conflicts} errors=${result.errors}`,
        ),
      );
      if (result.conflicts > 0) {
        console.log(
          pc.yellow(
            `\nSome targets already exist pointing elsewhere. Remove them manually and re-run, or run \`${APP_SHORT_ID} skills remove\` first if they are ours.`,
          ),
        );
      }
    });

  skills
    .command('remove')
    .description('Remove shipped-skill symlinks from the app data dir. Pass --global to target ~/.claude and ~/.agents.')
    .option('--global', 'Remove from the user-level ~/.claude/skills and ~/.agents/skills')
    .action(async (opts: { global?: boolean }) => {
      const { removeSkills } = await loadAgentex();
      const result = opts.global
        ? await removeSkills(skillDirs(), { location: 'global' })
        : await removeSkills(skillDirs(), { location: 'workspace', cwd: getAppRoot() });
      for (const e of result.entries) {
        const tag =
          e.status === 'removed'
            ? pc.green('-')
            : e.status === 'not_found'
              ? pc.dim('·')
              : e.status === 'conflict'
                ? pc.yellow('!')
                : pc.red('×');
        console.log(`  ${tag} ${e.target}/${e.skillName}  ${pc.dim(e.targetPath)}`);
      }
      console.log(pc.dim(`\nremoved=${result.removed}`));
    });

  skills
    .command('list')
    .description('List skills installed in the two standard channels. Pass --global for ~/.claude and ~/.agents.')
    .option('--global', 'List from the user-level ~/.claude/skills and ~/.agents/skills')
    .action(async (opts: { global?: boolean }) => {
      const { listInstalledSkills } = await loadAgentex();
      const installed = opts.global
        ? await listInstalledSkills({ location: 'global' })
        : await listInstalledSkills({ location: 'workspace', cwd: getAppRoot() });
      for (const [channel, entries] of Object.entries(installed)) {
        console.log(pc.bold(channel));
        if (entries.length === 0) {
          console.log(pc.dim('  (none)'));
          continue;
        }
        for (const s of entries) {
          const tag = s.isSymlink ? pc.green('↗') : pc.dim('·');
          console.log(`  ${tag} ${s.name}  ${pc.dim(s.sourcePath ?? '?')}`);
        }
      }
    });
}
