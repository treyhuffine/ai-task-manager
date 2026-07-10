/**
 * `<cli> skills` — install, list, remove the skills this app ships.
 *
 * Skills live at <package-root>/skills/*. Install uses agentex to symlink each
 * skill dir into both standard cross-agent discovery channels:
 *   ~/.agents/skills/<name>  (Codex, Cursor, Gemini, OpenCode, Pi)
 *   ~/.claude/skills/<name>  (Claude Code)
 *
 * Symlinks mean skill content tracks the source — upgrades pick up new
 * guidance automatically without a re-install.
 */

import pc from 'picocolors';
import { Command } from 'commander';
import { getAppRoot } from '@/lib/config/paths';
import { APP_SHORT_ID } from '@/constants/app';
import {
  configureGlobalSkill,
  installAppRootSkills,
  removeAppRootSkills,
} from '@/lib/agent-skills/shipped';

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
  return installAppRootSkills();
}

export function registerSkillsCommand(program: Command) {
  const skills = program
    .command('skills')
    .description('Install and manage the skills this app ships for agent sessions');

  skills
    .command('install')
    .description(
      'Symlink shipped skills into the app data dir (<app-root>/.claude/skills and <app-root>/.agents/skills). ' +
        'Pass --global to opt in to user-level ~/.claude/skills/ and ~/.agents/skills/.',
    )
    .option('--global', 'Install into the user-level ~/.claude/skills and ~/.agents/skills instead of the app data dir')
    .action(async (opts: { global?: boolean }) => {
      const isGlobal = !!opts.global;
      const result = isGlobal
        ? (await configureGlobalSkill(true)).install
        : await installAppRootSkills();

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
            `\nSome targets already exist pointing elsewhere. Remove them manually and re-run, or run \`${APP_SHORT_ID} skills remove${isGlobal ? ' --global' : ''}\` first if they are ours.`,
          ),
        );
      }
    });

  skills
    .command('remove')
    .description('Remove shipped-skill symlinks from the app data dir. Pass --global to target ~/.claude and ~/.agents.')
    .option('--global', 'Remove from the user-level ~/.claude/skills and ~/.agents/skills')
    .action(async (opts: { global?: boolean }) => {
      const result = opts.global
        ? (await configureGlobalSkill(false)).remove
        : await removeAppRootSkills();
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
