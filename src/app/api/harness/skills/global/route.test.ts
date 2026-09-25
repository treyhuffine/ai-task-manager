import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  configureGlobalSkill: vi.fn(),
  installAppRootSkills: vi.fn(),
  getGlobalSkillPreference: vi.fn(),
  removeOwnedProjectSkillLinks: vi.fn(),
  listWorkspaces: vi.fn(),
  listChatSessions: vi.fn(),
}));

vi.mock('@/lib/agent-skills/shipped', () => ({
  configureGlobalSkill: mocks.configureGlobalSkill,
  installAppRootSkills: mocks.installAppRootSkills,
  getGlobalSkillPreference: mocks.getGlobalSkillPreference,
  removeOwnedProjectSkillLinks: mocks.removeOwnedProjectSkillLinks,
}));

vi.mock('@/lib/db/queries', () => ({
  listWorkspaces: mocks.listWorkspaces,
  listChatSessions: mocks.listChatSessions,
}));

import { GET, PUT } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mocks.listWorkspaces.mockReturnValue([]);
  mocks.listChatSessions.mockReturnValue([]);
  mocks.removeOwnedProjectSkillLinks.mockResolvedValue({ entries: [], removed: 0 });
});

describe('global agent skill settings', () => {
  it('reports whether the user made an explicit choice', async () => {
    mocks.getGlobalSkillPreference.mockReturnValue(null);
    expect(await GET().json()).toEqual({
      enabled: false,
      configured: false,
    });

    mocks.getGlobalSkillPreference.mockReturnValue(true);
    expect(await GET().json()).toEqual({
      enabled: true,
      configured: true,
    });
  });

  it('rejects a non-boolean choice', async () => {
    const request = new NextRequest('http://localhost/api/harness/skills/global', {
      method: 'PUT',
      body: JSON.stringify({ enabled: 'yes' }),
    });

    const response = await PUT(request);
    expect(response.status).toBe(400);
  });

  it('applies the choice and cleans known workspace and worktree links', async () => {
    mocks.configureGlobalSkill.mockResolvedValue({
      enabled: true,
      install: { entries: [], installed: 2, skipped: 0, conflicts: 0, errors: 0 },
    });
    mocks.listWorkspaces
      .mockReturnValueOnce([{ cwd: '/repo/one' }])
      .mockReturnValueOnce([{ cwd: '/repo/two' }]);
    mocks.listChatSessions.mockReturnValue([
      { worktreePath: '/repo/one-worktree' },
      { worktreePath: '/repo/one-worktree' },
    ]);
    mocks.removeOwnedProjectSkillLinks.mockResolvedValue({ entries: [], removed: 1 });

    const request = new NextRequest('http://localhost/api/harness/skills/global', {
      method: 'PUT',
      body: JSON.stringify({ enabled: true }),
    });
    const response = await PUT(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.configureGlobalSkill).toHaveBeenCalledWith(true);
    expect(mocks.removeOwnedProjectSkillLinks).toHaveBeenCalledTimes(3);
    expect(mocks.removeOwnedProjectSkillLinks).toHaveBeenCalledWith('/repo/one');
    expect(mocks.removeOwnedProjectSkillLinks).toHaveBeenCalledWith('/repo/two');
    expect(mocks.removeOwnedProjectSkillLinks).toHaveBeenCalledWith('/repo/one-worktree');
    expect(body.projectCleanup).toEqual({ scanned: 3, removed: 3, errors: 0 });
  });
});

it('keeps desktop onboarding away from global skills and project cleanup', async () => {
  vi.stubEnv('RI_DESKTOP', '1');
  mocks.installAppRootSkills.mockResolvedValue({ installed: 2, errors: 0 });
  expect(await GET().json()).toEqual({ enabled: false, configured: true, appOnly: true });
  const response = await PUT(new NextRequest('http://localhost/api/harness/skills/global', { method: 'PUT', body: JSON.stringify({ enabled: true }) }));
  expect(response.status).toBe(200);
  expect(mocks.installAppRootSkills).toHaveBeenCalledOnce();
  expect(mocks.configureGlobalSkill).not.toHaveBeenCalled();
  expect(mocks.listWorkspaces).not.toHaveBeenCalled();
  expect(mocks.removeOwnedProjectSkillLinks).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
});
