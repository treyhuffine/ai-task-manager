/**
 * Skills stay current with the release that runs them (docs/always-on-spec.md
 * section 9). Every personal Home's server refreshes Ri's own skills when it
 * starts, which includes every update. Only the default Home, the one `ri agent`
 * reaches without `--root`, writes the global skills, and only when the person
 * turned them on: so they describe exactly the commands of the Home they reach.
 */
import { canonical } from '@/lib/service/paths';
import { getAppRoot, getProductionAppRoot } from '@/lib/config/paths';

export interface SkillRefresh {
  installAppRootSkills(): Promise<unknown>;
  installGlobalSkills(): Promise<unknown>;
  globalSkillsOn(): boolean;
  isDefaultHome(): Promise<boolean>;
  latestRelease(): string | null;
  installCommandLauncher(): unknown;
}

async function isDefaultHome() {
  const { defaultHome } = await import('@/lib/service/home-lookup');
  const home = defaultHome();
  const root = canonical(getAppRoot());
  return home ? home.identity.root === root : root === canonical(getProductionAppRoot());
}

async function realRefresh(): Promise<SkillRefresh> {
  const [shipped, store, runtime] = await Promise.all([import('./shipped'), import('@/lib/service/store'), import('@/lib/service/runtime')]);
  return {
    installAppRootSkills: () => shipped.installAppRootSkills(),
    installGlobalSkills: () => shipped.installGlobalSkills(),
    globalSkillsOn: () => shipped.getGlobalSkillPreference() === true,
    isDefaultHome, latestRelease: () => store.latestRelease(), installCommandLauncher: () => runtime.installCommandLauncher(),
  };
}

export async function refreshSkillsAtStartup(refresh?: SkillRefresh) {
  const skills = refresh ?? await realRefresh();
  await skills.installAppRootSkills();
  if (!skills.globalSkillsOn() || !(await skills.isDefaultHome())) return;
  // Global skills call `$HOME/.local/bin/ri`, so the launcher comes with them
  // wherever this computer has a release to run. It never replaces another program.
  if (skills.latestRelease()) skills.installCommandLauncher();
  await skills.installGlobalSkills();
}
