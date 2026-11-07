/**
 * How `ri` picks its Home and its release (docs/always-on-spec.md section 3.2
 * and 3.4).
 *
 * - A command about one Home that isn't told which finds it from the
 *   installation's records: the only Home, or the personal one among several.
 * - `ri` runs the newest release on this computer. A command about a Home is
 *   handed to the release that Home runs, so the CLI never meets a database
 *   newer or older than it expects. Installation commands stay on the newest.
 */
import path from 'node:path';
import fs from 'node:fs';
import { APP_ROOT_ENV, CONFIG_DIR_ENV, DB_PATH_ENV, WORK_DIR_ENV } from '@/lib/config/paths';
import { defaultHome } from '@/lib/service/home-lookup';
import { installedRuntime } from '@/lib/service/runtime';
import { runtimeReleaseIdentity } from '@/lib/releases/runtime-identity';

/** Commands about the installation, or that name their own folder. */
const INSTALLATION_COMMANDS = new Set(['update', 'doctor', 'start', 'help']);

/** About the release running them, not any Home. The install script runs one from
 * the release it just downloaded, whatever an older Home here runs. */
const OWN_RELEASE_COMMANDS = new Set(['install-release', 'compatibility', 'manifest', 'verify', 'add-to-terminal']);

export function isInstallationCommand(command: string, subcommand?: string) {
  return INSTALLATION_COMMANDS.has(command) || (command === 'team' && subcommand === 'create')
    || (command === 'service' && OWN_RELEASE_COMMANDS.has(subcommand ?? ''));
}

type Env = Record<string, string | undefined>;

/** A command told its Home's folder uses it, before anything picks a Home or a
 * release. `team create` and `update --root` read theirs themselves. */
export function selectExplicitRoot(command: string, commandRoot: unknown, actionRoot: unknown, env: Env = process.env) {
  const root = command === 'service' ? commandRoot : ['team', 'update'].includes(command) ? undefined : actionRoot;
  if (typeof root === 'string' && root) env[APP_ROOT_ENV] = path.resolve(/* turbopackIgnore: true */ root);
}

/** Point a command at the installation's default Home unless it was told one. */
export function selectDefaultHome(command: string, subcommand?: string, env: Env = process.env) {
  if (isInstallationCommand(command, subcommand)) return null;
  if (env[APP_ROOT_ENV] || env[DB_PATH_ENV]) return null;
  const home = defaultHome();
  if (!home) return null;
  Object.assign(env, { [APP_ROOT_ENV]: home.identity.root, [DB_PATH_ENV]: home.identity.database, [CONFIG_DIR_ENV]: home.identity.config, [WORK_DIR_ENV]: home.identity.work });
  return home.identity.root;
}

/** The release to hand this command to, or null to run it here. */
export function delegationTarget(command: string, subcommand?: string, env: Env = process.env) {
  if (env.RI_CLI_DELEGATED === '1' || isInstallationCommand(command, subcommand)) return null;
  let own: string;
  try {
    const identity = runtimeReleaseIdentity();
    // A checkout runs its own code, the way `pnpm cli:dev` always has.
    if (identity.source !== 'packaged') return null;
    own = identity.build;
  } catch { return null; }
  let active: ReturnType<typeof installedRuntime>;
  try { active = installedRuntime(); } catch { return null; }
  if (!active || active.id === own) return null;
  const cli = path.join(/* turbopackIgnore: true */ active.repo, 'dist/cli/index.mjs');
  if (!fs.existsSync(/* turbopackIgnore: true */ active.node) || !fs.existsSync(/* turbopackIgnore: true */ cli)) return null;
  return { node: active.node, cli, repo: active.repo, id: active.id };
}
