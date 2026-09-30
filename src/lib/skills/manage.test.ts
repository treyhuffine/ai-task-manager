import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import { skillDir } from './library';
import {
  archiveSkill,
  changeSkillReach,
  getSkillView,
  importSkill,
  newSkill,
  saveSkill,
  setSkillSessionControlForTests,
  skillsOverview,
} from './manage';

let home: TestHome;
let userHome: string;
let savedHome: string | undefined;
const control = {
  close: vi.fn<(chatSessionId: string) => Promise<{ closed: boolean }>>(async () => ({ closed: true })),
  recycleWhenIdle: vi.fn<(chatSessionId: string) => Promise<void>>(async () => {}),
  recycleWorkspaceSessions: vi.fn<(workspaceId: string) => Promise<void>>(async () => {}),
  recycleEveryAgentSession: vi.fn<(opts: { includeAppMainChat?: boolean }) => Promise<void>>(async () => {}),
};

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-skill-manage-' });
  userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-skill-manage-home-'));
  savedHome = process.env.HOME;
  process.env.HOME = userHome;
  for (const spy of Object.values(control)) spy.mockClear();
  setSkillSessionControlForTests(control);
});

afterEach(async () => {
  setSkillSessionControlForTests(null);
  process.env.HOME = savedHome;
  fs.rmSync(userHome, { recursive: true, force: true });
  await home.cleanup();
});

function skillChat(name: string, kind: 'skill' | 'skill-try') {
  return q.createChatSession({ type: 'content', harness: 'claude', surfaceKind: kind, surfaceRef: name, status: 'active' });
}

describe('newSkill', () => {
  it('starts off, named from what it should do', async () => {
    const skill = await newSkill({ intent: 'Triage my Gmail inbox every morning' });
    expect(skill.name).toBe('triage-gmail-inbox-morning');
    expect(skill.reach).toEqual({ mode: 'off' });
    expect(skill.problems.map((p) => p.field)).toContain('description');
  });

  it('never reuses a taken name', async () => {
    await newSkill({ intent: 'triage inbox' });
    expect((await newSkill({ intent: 'triage inbox' })).name).toBe('triage-inbox-2');
  });
});

describe('saveSkill', () => {
  beforeEach(async () => {
    await newSkill({ name: 'draft', description: 'Drafts replies.', body: 'Old.\n' });
  });

  it('saves fields and reports no rename', async () => {
    const { skill, renamedFrom } = await saveSkill('draft', { body: 'New.\n' });
    expect(skill.body).toBe('New.\n');
    expect(renamedFrom).toBeNull();
  });

  it('renames the folder, its reach, its chats and restarts those chats after their turn', async () => {
    const build = skillChat('draft', 'skill');
    const tryChat = skillChat('draft', 'skill-try');
    const { skill, renamedFrom } = await saveSkill('draft', { newName: 'draft-replies', description: 'Drafts email replies.' });
    expect(renamedFrom).toBe('draft');
    expect(skill.name).toBe('draft-replies');
    expect(skill.description).toBe('Drafts email replies.');
    expect(skill.reach).toEqual({ mode: 'off' });
    expect(q.getSkillScope('draft')).toBeNull();
    expect(q.getChatSession(build.id)?.surfaceRef).toBe('draft-replies');
    expect(q.getChatSession(tryChat.id)?.surfaceRef).toBe('draft-replies');
    expect(control.recycleWhenIdle).toHaveBeenCalledWith(build.id);
    expect(control.recycleWhenIdle).toHaveBeenCalledWith(tryChat.id);
    expect(control.close).not.toHaveBeenCalled();
  });

  it('follows a new name: line in whole-file content', async () => {
    const { skill, renamedFrom } = await saveSkill('draft', {
      content: '---\nname: reply-drafter\ndescription: Drafts replies.\n---\nBody.\n',
    });
    expect(renamedFrom).toBe('draft');
    expect(skill.name).toBe('reply-drafter');
    expect(await getSkillView('draft')).toBeNull();
  });

  it('checks a new name before writing anything', async () => {
    await newSkill({ name: 'taken', description: 'Taken.' });
    await expect(saveSkill('draft', { newName: 'taken', body: 'Lost?\n' })).rejects.toMatchObject({ code: 'conflict' });
    await expect(saveSkill('draft', { newName: 'Bad Name', body: 'Lost?\n' })).rejects.toMatchObject({ code: 'invalid' });
    expect((await getSkillView('draft'))?.body).toBe('Old.\n');
  });

  it('moves outside links with a rename', async () => {
    await changeSkillReach('draft', { mode: 'everywhere' });
    await saveSkill('draft', { newName: 'draft-replies' });
    const link = path.join(userHome, '.claude', 'skills', 'draft-replies');
    expect(fs.readlinkSync(link)).toBe(skillDir('draft-replies'));
    expect(fs.existsSync(path.join(userHome, '.claude', 'skills', 'draft'))).toBe(false);
    expect((await getSkillView('draft-replies'))?.reach).toEqual({ mode: 'everywhere' });
  });
});

describe('changeSkillReach', () => {
  let wsA: string;
  let wsB: string;

  beforeEach(async () => {
    wsA = q.createWorkspace({ name: 'A', cwd: path.join(home.root, 'a'), isGit: false, filesToCopy: [], status: 'active' }).id;
    wsB = q.createWorkspace({ name: 'B', cwd: path.join(home.root, 'b'), isGit: false, filesToCopy: [], status: 'active' }).id;
    await newSkill({ name: 'triage', description: 'Triage.', body: 'Steps.\n' });
  });

  it('restarts only the agents added or removed', async () => {
    await changeSkillReach('triage', { mode: 'agents', workspaceIds: [wsA] });
    expect(control.recycleWorkspaceSessions.mock.calls).toEqual([[wsA]]);
    control.recycleWorkspaceSessions.mockClear();
    await changeSkillReach('triage', { mode: 'agents', workspaceIds: [wsB] });
    expect(control.recycleWorkspaceSessions.mock.calls.map(([id]) => id).sort()).toEqual([wsA, wsB].sort());
    expect(control.recycleEveryAgentSession).not.toHaveBeenCalled();
  });

  it('restarts every agent and the main chat when every agent is involved', async () => {
    await changeSkillReach('triage', { mode: 'all' });
    expect(control.recycleEveryAgentSession).toHaveBeenCalledWith({ includeAppMainChat: true });
  });

  it('restarts nothing between every agent and everywhere', async () => {
    await changeSkillReach('triage', { mode: 'all' });
    control.recycleEveryAgentSession.mockClear();
    await changeSkillReach('triage', { mode: 'everywhere' });
    await changeSkillReach('triage', { mode: 'all' });
    expect(control.recycleEveryAgentSession).not.toHaveBeenCalled();
  });
});

describe('archiveSkill', () => {
  it('archives the folder, drops its reach and links, and archives its chats', async () => {
    await newSkill({ name: 'gone', description: 'Gone.', body: 'x\n' });
    await changeSkillReach('gone', { mode: 'everywhere' });
    const build = skillChat('gone', 'skill');
    const { archivedTo } = await archiveSkill('gone');
    expect(archivedTo.startsWith(path.join(home.root, '.archive', 'skills'))).toBe(true);
    expect(fs.existsSync(path.join(archivedTo, 'SKILL.md'))).toBe(true);
    expect(await getSkillView('gone')).toBeNull();
    expect(q.getSkillScope('gone')).toBeNull();
    expect(fs.existsSync(path.join(userHome, '.claude', 'skills', 'gone'))).toBe(false);
    expect(q.getChatSession(build.id)?.status).toBe('archived');
    expect(control.close).toHaveBeenCalledWith(build.id);
  });
});

describe('skillsOverview and importSkill', () => {
  it('lists library skills with their reach, and brings an outside skill in on everywhere', async () => {
    await newSkill({ name: 'drafting', description: 'Drafting.' });
    const theirs = path.join(userHome, '.claude', 'skills', 'implementing-specs');
    fs.mkdirSync(theirs, { recursive: true });
    fs.writeFileSync(path.join(theirs, 'SKILL.md'), '---\nname: implementing-specs\ndescription: Specs.\n---\nBody\n');

    const before = await skillsOverview();
    expect(before.skills).toEqual([expect.objectContaining({ name: 'drafting', reach: { mode: 'off' }, hasErrors: false })]);
    expect(before.outside.map((s) => s.name)).toEqual(['implementing-specs']);
    expect(before.canReachOutside).toBe(true);

    const imported = await importSkill('implementing-specs');
    expect(imported.reach).toEqual({ mode: 'everywhere' });
    const after = await skillsOverview();
    expect(after.outside).toEqual([]);
    expect(after.skills.map((s) => s.name)).toEqual(['drafting', 'implementing-specs']);
  });
});
