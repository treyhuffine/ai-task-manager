import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import { AGENT_BROWSER_SKILL_NAME } from '@/constants/app';
import {
  DRAFT,
  GLOBAL,
  RI,
  findSkill,
  isInstalled,
  linkMirror,
  listAllSkills,
  listSkillsAt,
  nameTakenAt,
  newSkillDir,
  parseSkillRef,
  projectPaths,
  skillRef,
  unlinkMirror,
} from './locations';

let home: TestHome;
let userHome: string;
let project: string;
let savedHome: string | undefined;
let wsId: string;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-skill-locations-' });
  userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-skill-user-home-'));
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-skill-project-'));
  savedHome = process.env.HOME;
  process.env.HOME = userHome;
  wsId = q.createWorkspace({ name: 'Blog', cwd: project, isGit: false, filesToCopy: [], status: 'active' }).id;
});

afterEach(async () => {
  process.env.HOME = savedHome;
  fs.rmSync(userHome, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
  await home.cleanup();
});

function skillIn(dir: string, name: string) {
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} does it.\n---\n`);
}

const claude = () => path.join(userHome, '.claude', 'skills');
const agents = () => path.join(userHome, '.agents', 'skills');

describe('refs', () => {
  it('round-trips every location, and reads a bare name as Ri', () => {
    for (const location of [DRAFT, RI, GLOBAL, { kind: 'project' as const, workspaceId: 'ws-1' }]) {
      expect(parseSkillRef(skillRef(location, 'review'))).toEqual({ location, name: 'review' });
    }
    expect(parseSkillRef('review')).toEqual({ location: RI, name: 'review' });
  });

  it('rejects refs that could name a path', () => {
    for (const bad of ['ri:../x', 'global:.hidden', 'draft:../x', 'draft:a:b', 'project::x', 'project:ws', 'other:x', 'a/b', 'ri:a:b']) {
      expect(parseSkillRef(bad)).toBeNull();
    }
  });
});

describe('listing', () => {
  it("lists Ri's own skills from <app-root>/skills", () => {
    skillIn(path.join(home.root, 'skills'), 'weekly-review');
    fs.mkdirSync(path.join(home.root, 'skills', 'no-skill-file'), { recursive: true });
    expect(listSkillsAt(RI).map((s) => s.ref)).toEqual(['ri:weekly-review']);
  });

  it('lists global skills once, links in from other tools as read-only, and skips Ri\'s shipped ones', () => {
    skillIn(claude(), 'implementing-specs');
    fs.mkdirSync(agents(), { recursive: true });
    fs.symlinkSync(path.join(claude(), 'implementing-specs'), path.join(agents(), 'implementing-specs'));
    skillIn(agents(), 'codex-only');
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-skill-elsewhere-'));
    skillIn(elsewhere, 'managed');
    fs.symlinkSync(path.join(elsewhere, 'managed'), path.join(claude(), 'managed'));
    skillIn(elsewhere, AGENT_BROWSER_SKILL_NAME);
    fs.symlinkSync(path.join(elsewhere, AGENT_BROWSER_SKILL_NAME), path.join(claude(), AGENT_BROWSER_SKILL_NAME));
    fs.mkdirSync(path.join(claude(), 'synced', 'abc'), { recursive: true });
    try {
      const global = listSkillsAt(GLOBAL);
      expect(global.map((s) => s.name)).toEqual(['codex-only', 'implementing-specs', 'managed']);
      expect(global.find((s) => s.name === 'implementing-specs')?.linkedFrom).toBeNull();
      expect(global.find((s) => s.name === 'managed')?.linkedFrom).toBe(path.join(elsewhere, 'managed'));
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("lists a project's skills from .claude/skills, .agents/skills and the older .ri/skills, skipping session links", () => {
    skillIn(path.join(project, '.claude', 'skills'), 'deploy');
    skillIn(path.join(project, '.agents', 'skills'), 'codex-deploy');
    skillIn(path.join(project, '.ri', 'skills'), 'legacy');
    // What Codex leaves behind when Ri attaches one of its own skills.
    skillIn(path.join(home.root, 'skills'), 'weekly-review');
    fs.symlinkSync(path.join(home.root, 'skills', 'weekly-review'), path.join(project, '.agents', 'skills', 'weekly-review'));
    const refs = listSkillsAt({ kind: 'project', workspaceId: wsId }).map((s) => s.ref);
    expect(refs).toEqual([`project:${wsId}:codex-deploy`, `project:${wsId}:deploy`, `project:${wsId}:legacy`]);
  });

  it('lists everything together, and finds one by ref', () => {
    skillIn(path.join(home.root, 'skills'), 'a');
    skillIn(claude(), 'b');
    skillIn(path.join(project, '.claude', 'skills'), 'c');
    skillIn(path.join(home.root, 'skill-drafts'), 'd');
    expect(listAllSkills().map((s) => s.ref)).toEqual(['ri:a', 'global:b', `project:${wsId}:c`, 'draft:d']);
    expect(findSkill('draft:d')?.dir).toBe(path.join(home.root, 'skill-drafts', 'd'));
    expect(findSkill(`project:${wsId}:c`)?.dir).toBe(path.join(project, '.claude', 'skills', 'c'));
    expect(findSkill('ri:missing')).toBeNull();
    expect(findSkill('project:no-such-agent:c')).toBeNull();
  });

  it('leaves out an agent whose folder is not on this computer', () => {
    q.createWorkspace({ name: 'Elsewhere', cwd: path.join(project, 'nope'), isGit: false, filesToCopy: [], status: 'active' });
    expect(listAllSkills()).toEqual([]);
  });
});

describe('writing places', () => {
  it('puts new skills in .claude/skills and links them into .agents/skills (relative in a project)', () => {
    const location = { kind: 'project' as const, workspaceId: wsId };
    const dir = newSkillDir(location, 'deploy');
    expect(dir).toBe(path.join(project, '.claude', 'skills', 'deploy'));
    skillIn(path.dirname(dir), 'deploy');
    linkMirror(location, dir);
    expect(fs.readlinkSync(path.join(project, '.agents', 'skills', 'deploy'))).toBe(path.join('..', '..', '.claude', 'skills', 'deploy'));
    expect(listSkillsAt(location).map((s) => s.name)).toEqual(['deploy']);
    expect(nameTakenAt(location, 'deploy')).toBe(true);
    expect(projectPaths(findSkill(`project:${wsId}:deploy`)!)).toEqual({
      cwd: project,
      paths: ['.claude/skills/deploy', '.agents/skills/deploy'],
    });
    unlinkMirror(location, dir);
    expect(fs.existsSync(path.join(project, '.agents', 'skills', 'deploy'))).toBe(false);
  });

  it('links a global skill into ~/.agents/skills with an absolute link, and leaves an existing entry alone', () => {
    const dir = newSkillDir(GLOBAL, 'triage');
    skillIn(path.dirname(dir), 'triage');
    linkMirror(GLOBAL, dir);
    expect(fs.readlinkSync(path.join(agents(), 'triage'))).toBe(dir);
    skillIn(agents(), 'theirs');
    skillIn(claude(), 'theirs');
    linkMirror(GLOBAL, path.join(claude(), 'theirs'));
    expect(fs.lstatSync(path.join(agents(), 'theirs')).isSymbolicLink()).toBe(false);
  });

  it('writes drafts to <app-root>/skill-drafts, with no link for any harness to find', () => {
    const dir = newSkillDir(DRAFT, 'idea');
    expect(dir).toBe(path.join(home.root, 'skill-drafts', 'idea'));
    skillIn(path.dirname(dir), 'idea');
    linkMirror(DRAFT, dir);
    expect(fs.readdirSync(path.join(home.root, 'skill-drafts'))).toEqual(['idea']);
    expect(isInstalled(DRAFT)).toBe(false);
    expect([RI, GLOBAL, { kind: 'project' as const, workspaceId: wsId }].every(isInstalled)).toBe(true);
  });

  it('keeps global skills out of the desktop app', () => {
    process.env.RI_DESKTOP = '1';
    try {
      expect(() => newSkillDir(GLOBAL, 'x')).toThrow(/desktop/);
    } finally {
      delete process.env.RI_DESKTOP;
    }
  });
});
