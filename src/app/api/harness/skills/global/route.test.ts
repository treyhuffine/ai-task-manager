import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  configureGlobalSkill: vi.fn(),
  installAppRootSkills: vi.fn(),
  getGlobalSkillPreference: vi.fn(),
  inspectGlobalSkills: vi.fn(),
  removeOwnedProjectSkillLinks: vi.fn(),
  listWorkspaces: vi.fn(),
  listChatSessions: vi.fn(),
}));

vi.mock('@/lib/agent-skills/shipped', () => ({
  configureGlobalSkill: mocks.configureGlobalSkill,
  installAppRootSkills: mocks.installAppRootSkills,
  getGlobalSkillPreference: mocks.getGlobalSkillPreference,
  inspectGlobalSkills: mocks.inspectGlobalSkills,
  removeOwnedProjectSkillLinks: mocks.removeOwnedProjectSkillLinks,
  displayHomePath: (p: string) => p.replace('/Users/someone', '~'),
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
  it('reports the saved choice next to what is on disk', async () => {
    mocks.getGlobalSkillPreference.mockReturnValue(null);
    const folders = ['~/.agents/skills', '~/.claude/skills', '~/.gemini/config/skills'];
    mocks.inspectGlobalSkills.mockResolvedValue({ installed: false, conflicts: [], folders });
    expect(await (await GET(new Request('http://localhost/api/test'))).json()).toEqual({
      enabled: false,
      configured: false,
      appOnly: false,
      installed: false,
      conflicts: [],
      folders,
    });

    // Chosen, but someone's own skill holds the name.
    mocks.getGlobalSkillPreference.mockReturnValue(true);
    mocks.inspectGlobalSkills.mockResolvedValue({ installed: false, conflicts: ['~/.claude/skills/agent-work-tasks-notes_ri'], folders });
    expect(await (await GET(new Request('http://localhost/api/test'))).json()).toEqual({
      enabled: true,
      configured: true,
      appOnly: false,
      installed: false,
      conflicts: ['~/.claude/skills/agent-work-tasks-notes_ri'],
      folders,
    });
  });

  it('says where a taken name is and what to do about it', async () => {
    mocks.configureGlobalSkill.mockResolvedValue({
      enabled: true,
      install: {
        entries: [
          { target: 'claude', skillName: 'agent-work-tasks-notes_ri', status: 'conflict', targetPath: '/Users/someone/.claude/skills/agent-work-tasks-notes_ri' },
          { target: 'agents', skillName: 'agent-work-tasks-notes_ri', status: 'created', targetPath: '/Users/someone/.agents/skills/agent-work-tasks-notes_ri' },
        ],
        installed: 1, skipped: 0, conflicts: 1, errors: 0,
      },
    });
    const response = await PUT(new NextRequest('http://localhost/api/harness/skills/global', { method: 'PUT', body: JSON.stringify({ enabled: true }) }));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe(
      'Another skill is already at ~/.claude/skills/agent-work-tasks-notes_ri, so Ri left it alone. Remove or rename it, then install again.',
    );
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
  expect(await (await GET(new Request('http://localhost/api/test'))).json()).toEqual({ enabled: false, configured: true, appOnly: true, installed: false, conflicts: [], folders: [] });
  expect(mocks.inspectGlobalSkills).not.toHaveBeenCalled();
  const response = await PUT(new NextRequest('http://localhost/api/harness/skills/global', { method: 'PUT', body: JSON.stringify({ enabled: true }) }));
  expect(response.status).toBe(200);
  expect(mocks.installAppRootSkills).toHaveBeenCalledOnce();
  expect(mocks.configureGlobalSkill).not.toHaveBeenCalled();
  expect(mocks.listWorkspaces).not.toHaveBeenCalled();
  expect(mocks.removeOwnedProjectSkillLinks).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
});
