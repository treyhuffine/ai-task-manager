import fs from 'node:fs';
import path from 'node:path';

export const SUPERVISOR_OPT_IN = 'install-test-job-on-disposable-github-hosted-account';

export function isWithin(directory: string, file: string) {
  const relative = path.relative(fs.realpathSync(directory), fs.realpathSync(file));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Native login jobs belong to an account, not RI_ROOT. Only the disposable
 * hosted CI account may run this mode. A developer's default run never calls
 * launchctl/systemctl or writes a login job, even when CI=true is inherited. */
export function assertDisposableSupervisorAccount(env: Partial<NodeJS.ProcessEnv>, temporary: string, accountHome: string) {
  if (env.RI_SERVICE_SMOKE_SUPERVISOR !== SUPERVISOR_OPT_IN || env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted' || env.CI !== 'true') {
    throw new Error('OS supervision qualification requires an explicitly opted-in disposable GitHub-hosted account');
  }
  if (!env.RUNNER_TEMP || !isWithin(env.RUNNER_TEMP, temporary)) throw new Error('OS supervision fixture must be inside RUNNER_TEMP');
  if (!env.HOME || fs.realpathSync(env.HOME) !== fs.realpathSync(accountHome)) throw new Error('OS supervision qualification must use the disposable account home');
  if (fs.realpathSync(accountHome) === fs.realpathSync(temporary) || isWithin(temporary, accountHome)) throw new Error('Keep the account home and qualification data separate');
}

/** Preserve exactly the service's non-secret host plumbing. New fixture paths
 * are supplied separately. No inherited provider key, RI override, NODE_OPTIONS,
 * loader, proxy, or npm configuration reaches the staged runtime. */
export function fixtureEnvironment(env: Partial<NodeJS.ProcessEnv>, fixture: { temporary: string; accountHome?: string }): NodeJS.ProcessEnv {
  const next: Partial<NodeJS.ProcessEnv> = {};
  for (const name of ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']) {
    if (env[name]) next[name] = env[name];
  }
  return { ...next, HOME: fixture.accountHome ?? path.join(fixture.temporary, 'account'), NODE_ENV: 'production',
    RI_ROOT: path.join(fixture.temporary, 'home'), RI_DB_PATH: path.join(fixture.temporary, 'database.sqlite'),
    RI_CONFIG_DIR: path.join(fixture.temporary, 'config'), RI_WORK_DIR: path.join(fixture.temporary, 'work'),
    RI_INSTALL_ROOT: path.join(fixture.temporary, 'installed'), RI_DESKTOP: '1', RI_DESKTOP_MODE: 'production', NEXT_DIST_DIR: '.next-desktop' };
}
