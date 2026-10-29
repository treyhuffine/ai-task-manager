import { expect, it, vi } from 'vitest';
import { refreshSkillsAtStartup, type SkillRefresh } from './startup';

function skills(options: Partial<{ on: boolean; defaultHome: boolean; release: string | null }> = {}) {
  const calls: string[] = [];
  const refresh: SkillRefresh = {
    installAppRootSkills: vi.fn(async () => { calls.push('own'); }),
    installGlobalSkills: vi.fn(async () => { calls.push('global'); }),
    globalSkillsOn: () => options.on ?? true,
    isDefaultHome: async () => options.defaultHome ?? true,
    latestRelease: () => options.release === undefined ? 'a'.repeat(64) : options.release,
    installCommandLauncher: vi.fn(() => { calls.push('launcher'); }),
  };
  return { refresh, calls };
}

it("refreshes Ri's own skills on every start, so an update never leaves them behind", async () => {
  const { refresh, calls } = skills({ on: false });
  await refreshSkillsAtStartup(refresh);
  expect(calls).toEqual(['own']);
});

it('writes global skills only from the default Home, with the launcher they call', async () => {
  const fromDefault = skills();
  await refreshSkillsAtStartup(fromDefault.refresh);
  expect(fromDefault.calls).toEqual(['own', 'launcher', 'global']);
  const fromAnother = skills({ defaultHome: false });
  await refreshSkillsAtStartup(fromAnother.refresh);
  expect(fromAnother.calls).toEqual(['own']);
});

it('leaves the launcher alone on a Home run from a checkout, with no release installed', async () => {
  const { refresh, calls } = skills({ release: null });
  await refreshSkillsAtStartup(refresh);
  expect(calls).toEqual(['own', 'global']);
});
