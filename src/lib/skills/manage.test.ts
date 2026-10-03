import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import {
  archiveSkill,
  commitSkill,
  getSkillView,
  moveSkill,
  newSkill,
  saveSkill,
  setSkillSessionControlForTests,
  skillsOverview,
} from './manage';

const RI = { kind: 'ri' } as const;
const DRAFT = { kind: 'draft' } as const;

let home: TestHome;
let userHome: string;
let repo: string;
let savedEnv: Record<string, string | undefined>;
let wsId: string;
const IDENTITY = { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@e.co', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@e.co' };
const control = {
  close: vi.fn<(chatSessionId: string) => Promise<{ closed: boolean }>>(async () => ({ closed: true })),
  recycleWhenIdle: vi.fn<(chatSessionId: string) => Promise<void>>(async () => {}),
};

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-skill-manage-' });
  userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-skill-manage-home-'));
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-skill-manage-repo-'));
  savedEnv = { HOME: process.env.HOME, ...Object.fromEntries(Object.keys(IDENTITY).map((k) => [k, process.env[k]])) };
  process.env.HOME = userHome;
  Object.assign(process.env, IDENTITY);
  execFileSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'README.md'), 'hi\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '--quiet', '-m', 'init'], { cwd: repo });
  wsId = q.createWorkspace({ name: 'Blog', cwd: repo, isGit: true, filesToCopy: [], status: 'active' }).id;
  for (const spy of Object.values(control)) spy.mockClear();
  setSkillSessionControlForTests(control);
});

afterEach(async () => {
  setSkillSessionControlForTests(null);
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(userHome, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
  await home.cleanup();
});

function skillChat(ref: string, kind: 'skill' | 'skill-try') {
  return q.createChatSession({ type: 'content', harness: 'claude', surfaceKind: kind, surfaceRef: ref, status: 'active' });
}

describe('newSkill', () => {
  it('starts as a draft that nothing reads, named from what it should do', async () => {
    const skill = await newSkill({ intent: 'Triage my Gmail inbox every morning' });
    expect(skill.ref).toBe('draft:triage-gmail-inbox-morning');
    expect(skill.dir).toBe(path.join(home.root, 'skill-drafts', 'triage-gmail-inbox-morning'));
    expect(skill.location).toEqual({ kind: 'draft' });
    expect(fs.existsSync(path.join(home.root, 'skills', 'triage-gmail-inbox-morning'))).toBe(false);
  });

  it('never reuses a taken name in the same place', async () => {
    await newSkill({ intent: 'triage inbox' });
    expect((await newSkill({ intent: 'triage inbox' })).name).toBe('triage-inbox-2');
  });

  it('hands back a blank draft nobody has used instead of starting another', async () => {
    const first = await newSkill({});
    expect(first.ref).toBe('draft:new-skill');
    expect((await newSkill({})).ref).toBe('draft:new-skill');

    // Written in: kept, and the next one is new.
    await saveSkill(first.ref, { description: 'Reviews pull requests.' });
    const second = await newSkill({});
    expect(second.ref).toBe('draft:new-skill-2');

    // Talked about in its builder chat, even with the file still blank: kept too.
    const build = skillChat(second.ref, 'skill');
    expect((await newSkill({})).ref).toBe('draft:new-skill-2');
    q.insertChatEvent({ sessionId: build.id, role: 'user', source: 'user', content: 'It should review PRs.' });
    expect((await newSkill({})).ref).toBe('draft:new-skill-3');
  });

  it('never hands back a blank skill that is installed', async () => {
    await newSkill({ name: 'new-skill', location: RI });
    expect((await newSkill({})).ref).toBe('draft:new-skill');
  });

  it('can go global or in a project, linked for every harness', async () => {
    const global = await newSkill({ name: 'mine', location: { kind: 'global' } });
    expect(global.dir).toBe(path.join(userHome, '.claude', 'skills', 'mine'));
    expect(fs.readlinkSync(path.join(userHome, '.agents', 'skills', 'mine'))).toBe(global.dir);
    const project = await newSkill({ name: 'deploy', description: 'Deploys.', location: { kind: 'project', workspaceId: wsId } });
    expect(project.location).toMatchObject({ kind: 'project', projectName: 'Blog', isGit: true });
    expect(project.uncommitted).toBe(true);
    expect(project.git).toEqual({ branch: 'main' });
  });
});

describe('saveSkill', () => {
  beforeEach(async () => {
    await newSkill({ name: 'draft', description: 'Drafts replies.', body: 'Old.\n', location: RI });
  });

  it('saves fields and reports no rename', async () => {
    const { skill, renamedFrom } = await saveSkill('ri:draft', { body: 'New.\n' });
    expect(skill.body).toBe('New.\n');
    expect(renamedFrom).toBeNull();
  });

  it('renames the folder and its chats, and restarts those chats after their turn', async () => {
    const build = skillChat('ri:draft', 'skill');
    const legacy = skillChat('draft', 'skill-try');
    const { skill, renamedFrom } = await saveSkill('ri:draft', { newName: 'draft-replies', description: 'Drafts email replies.' });
    expect(renamedFrom).toBe('ri:draft');
    expect(skill.ref).toBe('ri:draft-replies');
    expect(skill.description).toBe('Drafts email replies.');
    expect(q.getChatSession(build.id)?.surfaceRef).toBe('ri:draft-replies');
    expect(q.getChatSession(legacy.id)?.surfaceRef).toBe('ri:draft-replies');
    expect(control.recycleWhenIdle).toHaveBeenCalledWith(build.id);
    expect(control.close).not.toHaveBeenCalled();
  });

  it('follows a new name: line in whole-file content', async () => {
    const { skill, renamedFrom } = await saveSkill('ri:draft', {
      content: '---\nname: reply-drafter\ndescription: Drafts replies.\n---\nBody.\n',
    });
    expect(renamedFrom).toBe('ri:draft');
    expect(skill.ref).toBe('ri:reply-drafter');
    expect(await getSkillView('ri:draft')).toBeNull();
  });

  it('checks a new name before writing anything', async () => {
    await newSkill({ name: 'taken', description: 'Taken.', location: RI });
    await expect(saveSkill('ri:draft', { newName: 'taken', body: 'Lost?\n' })).rejects.toMatchObject({ code: 'conflict' });
    await expect(saveSkill('ri:draft', { newName: 'Bad Name', body: 'Lost?\n' })).rejects.toMatchObject({ code: 'invalid' });
    expect((await getSkillView('ri:draft'))?.body).toBe('Old.\n');
  });

  it('moves the .agents/skills link with a rename in a project', async () => {
    await newSkill({ name: 'deploy', location: { kind: 'project', workspaceId: wsId } });
    await saveSkill(`project:${wsId}:deploy`, { newName: 'ship' });
    expect(fs.readlinkSync(path.join(repo, '.agents', 'skills', 'ship'))).toBe(path.join('..', '..', '.claude', 'skills', 'ship'));
    expect(fs.existsSync(path.join(repo, '.agents', 'skills', 'deploy'))).toBe(false);
  });

  it("won't edit a skill another tool links in", async () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-skill-elsewhere-'));
    fs.mkdirSync(path.join(elsewhere, 'theirs'));
    fs.writeFileSync(path.join(elsewhere, 'theirs', 'SKILL.md'), '---\nname: theirs\ndescription: T.\n---\n');
    fs.mkdirSync(path.join(userHome, '.claude', 'skills'), { recursive: true });
    fs.symlinkSync(path.join(elsewhere, 'theirs'), path.join(userHome, '.claude', 'skills', 'theirs'));
    try {
      expect((await getSkillView('global:theirs'))?.editable).toBe(false);
      await expect(saveSkill('global:theirs', { body: 'x' })).rejects.toMatchObject({ code: 'invalid' });
      const copy = await moveSkill('global:theirs', { kind: 'ri' }, { copy: true });
      expect(copy.editable).toBe(true);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

describe('moveSkill', () => {
  it('installs a draft, carrying its chats, and uninstalls it back to a draft', async () => {
    await newSkill({ name: 'triage', description: 'Triage.', body: 'Steps.\n' });
    const build = skillChat('draft:triage', 'skill');
    const installed = await moveSkill('draft:triage', RI);
    expect(installed.ref).toBe('ri:triage');
    expect(installed.dir).toBe(path.join(home.root, 'skills', 'triage'));
    expect(fs.existsSync(path.join(home.root, 'skill-drafts', 'triage'))).toBe(false);
    expect(q.getChatSession(build.id)?.surfaceRef).toBe('ri:triage');
    expect(control.recycleWhenIdle).toHaveBeenCalledWith(build.id);

    const back = await moveSkill('ri:triage', DRAFT);
    expect(back.ref).toBe('draft:triage');
    expect(back.location).toEqual({ kind: 'draft' });
    expect(q.getChatSession(build.id)?.surfaceRef).toBe('draft:triage');
  });

  it('installs a draft straight into a project, linked for every harness', async () => {
    await newSkill({ name: 'deploy', description: 'Deploys.', body: 'Steps.\n' });
    const installed = await moveSkill('draft:deploy', { kind: 'project', workspaceId: wsId });
    expect(installed).toMatchObject({ ref: `project:${wsId}:deploy`, uncommitted: true });
    expect(fs.readlinkSync(path.join(repo, '.agents', 'skills', 'deploy'))).toBe(path.join('..', '..', '.claude', 'skills', 'deploy'));
  });

  it("won't install a skill with something wrong in it, and says what", async () => {
    await newSkill({ name: 'unfinished', body: 'Steps.\n' });
    await expect(moveSkill('draft:unfinished', RI)).rejects.toMatchObject({
      code: 'invalid',
      message: expect.stringMatching(/^Fix this before installing unfinished\. Say what it does/),
    });
    await expect(moveSkill('draft:unfinished', { kind: 'project', workspaceId: wsId }, { copy: true })).rejects.toMatchObject({
      code: 'invalid',
    });
    expect(fs.existsSync(path.join(home.root, 'skill-drafts', 'unfinished', 'SKILL.md'))).toBe(true);

    // Uninstalling never needs it to be finished.
    await newSkill({ name: 'broken', description: 'Works.', location: RI });
    await saveSkill('ri:broken', { description: '' });
    await expect(moveSkill('ri:broken', DRAFT)).resolves.toMatchObject({ ref: 'draft:broken' });
  });

  it('moves between Ri and global, carrying its chats and links', async () => {
    await newSkill({ name: 'triage', description: 'Triage.', body: 'Steps.\n', location: RI });
    const build = skillChat('ri:triage', 'skill');
    const global = await moveSkill('ri:triage', { kind: 'global' });
    expect(global.ref).toBe('global:triage');
    expect(fs.existsSync(path.join(home.root, 'skills', 'triage'))).toBe(false);
    expect(fs.readlinkSync(path.join(userHome, '.agents', 'skills', 'triage'))).toBe(global.dir);
    expect(q.getChatSession(build.id)?.surfaceRef).toBe('global:triage');

    const back = await moveSkill('global:triage', { kind: 'ri' });
    expect(back.ref).toBe('ri:triage');
    expect(fs.existsSync(path.join(userHome, '.agents', 'skills', 'triage'))).toBe(false);
  });

  it('shares with a project by copying, and leaves the original', async () => {
    await newSkill({ name: 'review', description: 'Review.', body: 'Steps.\n', location: RI });
    const copy = await moveSkill('ri:review', { kind: 'project', workspaceId: wsId }, { copy: true });
    expect(copy.ref).toBe(`project:${wsId}:review`);
    expect(copy.uncommitted).toBe(true);
    expect(await getSkillView('ri:review')).not.toBeNull();
  });

  it('refuses a taken name or the same place', async () => {
    await newSkill({ name: 'dupe', description: 'D.', location: RI });
    await newSkill({ name: 'dupe', description: 'D.', location: { kind: 'global' } });
    await expect(moveSkill('ri:dupe', { kind: 'global' })).rejects.toMatchObject({ code: 'conflict' });
    await expect(moveSkill('ri:dupe', { kind: 'ri' })).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('commitSkill', () => {
  it("commits a project skill's files and nothing else", async () => {
    await newSkill({ name: 'deploy', description: 'Deploys.', location: { kind: 'project', workspaceId: wsId } });
    fs.writeFileSync(path.join(repo, 'unrelated.txt'), 'x');
    const { skill, commit } = await commitSkill(`project:${wsId}:deploy`);
    expect(commit.message).toBe('Add the deploy skill');
    expect(skill.uncommitted).toBe(false);
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: repo }).toString().trim();
    expect(status).toBe('?? unrelated.txt');
  });

  it('only commits project skills', async () => {
    await newSkill({ name: 'ri-one', description: 'D.', location: RI });
    await expect(commitSkill('ri:ri-one')).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('archiveSkill', () => {
  it('archives the folder, drops its link, and archives its chats', async () => {
    await newSkill({ name: 'gone', description: 'Gone.', location: { kind: 'global' } });
    const build = skillChat('global:gone', 'skill');
    const { archivedTo } = await archiveSkill('global:gone');
    expect(archivedTo.startsWith(path.join(home.root, '.archive', 'skills', 'global-gone-'))).toBe(true);
    expect(fs.existsSync(path.join(archivedTo, 'SKILL.md'))).toBe(true);
    expect(await getSkillView('global:gone')).toBeNull();
    expect(fs.existsSync(path.join(userHome, '.agents', 'skills', 'gone'))).toBe(false);
    expect(q.getChatSession(build.id)?.status).toBe('archived');
    expect(control.close).toHaveBeenCalledWith(build.id);
  });
});

describe('skillsOverview', () => {
  it('lists every place, marks uncommitted project skills, and offers the projects', async () => {
    await newSkill({ name: 'a', description: 'A.', location: RI });
    await newSkill({ name: 'b', description: 'B.', location: { kind: 'global' } });
    await newSkill({ name: 'c', description: 'C.', location: { kind: 'project', workspaceId: wsId } });
    await newSkill({ name: 'd', description: 'D.' });
    const overview = await skillsOverview();
    expect(overview.skills.map((s) => [s.ref, s.uncommitted])).toEqual([
      ['ri:a', false],
      ['global:b', false],
      [`project:${wsId}:c`, true],
      ['draft:d', false],
    ]);
    expect(overview.projects).toEqual([{ workspaceId: wsId, name: 'Blog', cwd: repo, isGit: true }]);
    expect(overview.canWriteGlobal).toBe(true);
  });
});
