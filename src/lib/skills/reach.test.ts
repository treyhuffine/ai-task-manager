import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import { excludedSkills } from './exclusions';
import { createSkill, skillDir } from './library';
import { getSkillReach, listSkillReaches, reachFrom, setSkillReach, widens, type SkillReach } from './reach';

describe('reachFrom', () => {
  it('reads the row and the outside links as one setting', () => {
    expect(reachFrom(null, false)).toEqual({ mode: 'all' });
    expect(reachFrom(null, true)).toEqual({ mode: 'everywhere' });
    expect(reachFrom({ workspaceIds: [] }, false)).toEqual({ mode: 'off' });
    expect(reachFrom({ workspaceIds: ['a'] }, false)).toEqual({ mode: 'agents', workspaceIds: ['a'] });
  });
});

describe('widens', () => {
  const off: SkillReach = { mode: 'off' };
  const a: SkillReach = { mode: 'agents', workspaceIds: ['a'] };
  const ab: SkillReach = { mode: 'agents', workspaceIds: ['a', 'b'] };
  const all: SkillReach = { mode: 'all' };
  const everywhere: SkillReach = { mode: 'everywhere' };

  it('calls turning on or adding reach a widening', () => {
    expect(widens(off, a)).toBe(true);
    expect(widens(a, ab)).toBe(true);
    expect(widens(a, { mode: 'agents', workspaceIds: ['b'] })).toBe(true);
    expect(widens(ab, all)).toBe(true);
    expect(widens(all, everywhere)).toBe(true);
  });

  it('lets narrowing and no-ops through', () => {
    expect(widens(everywhere, all)).toBe(false);
    expect(widens(all, a)).toBe(false);
    expect(widens(ab, a)).toBe(false);
    expect(widens(a, off)).toBe(false);
    expect(widens(all, all)).toBe(false);
  });
});

describe('excludedSkills', () => {
  const scopes = [
    { name: 'drafting', workspaceIds: [] },
    { name: 'only-a', workspaceIds: ['ws-a'] },
  ];

  it('leaves out off skills everywhere and scoped ones outside their agents', () => {
    expect(excludedSkills(scopes, { workspaceId: null, surfaceKind: null, surfaceRef: null })).toEqual(['drafting', 'only-a']);
    expect(excludedSkills(scopes, { workspaceId: 'ws-a', surfaceKind: null, surfaceRef: null })).toEqual(['drafting']);
    expect(excludedSkills(scopes, { workspaceId: 'ws-b', surfaceKind: null, surfaceRef: null })).toEqual(['drafting', 'only-a']);
    expect(excludedSkills([], { workspaceId: null, surfaceKind: null, surfaceRef: null })).toEqual([]);
  });

  it('gives a try chat the skill it tries, even while it is off', () => {
    expect(excludedSkills(scopes, { workspaceId: null, surfaceKind: 'skill-try', surfaceRef: 'drafting' })).toEqual(['only-a']);
  });

  it('keeps a builder chat from getting the skill it writes, even when it is on', () => {
    expect(excludedSkills([], { workspaceId: null, surfaceKind: 'skill', surfaceRef: 'live-one' })).toEqual(['live-one']);
  });
});

describe('setSkillReach', () => {
  let home: TestHome;
  let userHome: string;
  let savedHome: string | undefined;
  let wsA: string;
  let wsB: string;

  beforeEach(async () => {
    home = await createTestHome({ prefix: 'ri-skill-reach-' });
    userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-skill-reach-home-'));
    savedHome = process.env.HOME;
    process.env.HOME = userHome;
    wsA = q.createWorkspace({ name: 'A', cwd: path.join(home.root, 'a'), isGit: false, filesToCopy: [], status: 'active' }).id;
    wsB = q.createWorkspace({ name: 'B', cwd: path.join(home.root, 'b'), isGit: false, filesToCopy: [], status: 'active' }).id;
    createSkill({ name: 'triage', description: 'Triage the inbox.', body: 'Steps.\n' });
  });

  afterEach(async () => {
    process.env.HOME = savedHome;
    fs.rmSync(userHome, { recursive: true, force: true });
    await home.cleanup();
  });

  const linked = () => fs.existsSync(path.join(userHome, '.claude', 'skills', 'triage'));

  it('moves through every mode and keeps the row and the links in step', async () => {
    expect(await getSkillReach('triage')).toEqual({ mode: 'all' });

    expect(await setSkillReach('triage', { mode: 'everywhere' })).toEqual({ mode: 'everywhere' });
    expect(linked()).toBe(true);
    expect(q.getSkillScope('triage')).toBeNull();

    expect(await setSkillReach('triage', { mode: 'agents', workspaceIds: [wsA, wsA, wsB] })).toEqual({
      mode: 'agents',
      workspaceIds: [wsA, wsB],
    });
    expect(linked()).toBe(false);

    expect(await setSkillReach('triage', { mode: 'off' })).toEqual({ mode: 'off' });
    expect(q.getSkillScope('triage')?.workspaceIds).toEqual([]);

    expect(await setSkillReach('triage', { mode: 'all' })).toEqual({ mode: 'all' });
    expect(q.getSkillScope('triage')).toBeNull();
    expect(linked()).toBe(false);
  });

  it('reports every skill in one pass', async () => {
    createSkill({ name: 'other', description: 'Other.' });
    await setSkillReach('other', { mode: 'off' });
    const reaches = await listSkillReaches();
    expect(reaches.get('triage')).toEqual({ mode: 'all' });
    expect(reaches.get('other')).toEqual({ mode: 'off' });
  });

  it('will not turn on a skill with blocking problems, but will turn it off', async () => {
    createSkill({ name: 'unfinished' });
    await expect(setSkillReach('unfinished', { mode: 'all' })).rejects.toMatchObject({ code: 'invalid' });
    expect(await setSkillReach('unfinished', { mode: 'off' })).toEqual({ mode: 'off' });
  });

  it('needs real agents for "only these agents"', async () => {
    await expect(setSkillReach('triage', { mode: 'agents', workspaceIds: [] })).rejects.toMatchObject({ code: 'invalid' });
    await expect(setSkillReach('triage', { mode: 'agents', workspaceIds: ['nope'] })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('fails "everywhere" before changing anything when a different skill holds the name outside', async () => {
    await setSkillReach('triage', { mode: 'off' });
    const theirs = path.join(userHome, '.claude', 'skills', 'triage');
    fs.mkdirSync(theirs, { recursive: true });
    fs.writeFileSync(path.join(theirs, 'SKILL.md'), '---\nname: triage\ndescription: Theirs.\n---\n');
    await expect(setSkillReach('triage', { mode: 'everywhere' })).rejects.toMatchObject({ code: 'conflict' });
    expect(await getSkillReach('triage')).toEqual({ mode: 'off' });
  });

  it('clears the links Codex left once a skill no longer reaches an agent', async () => {
    const appLinks = path.join(home.root, '.agents', 'skills');
    fs.mkdirSync(appLinks, { recursive: true });
    fs.symlinkSync(skillDir('triage'), path.join(appLinks, 'triage'));
    await setSkillReach('triage', { mode: 'agents', workspaceIds: [wsA] });
    expect(fs.existsSync(path.join(appLinks, 'triage'))).toBe(false);
  });
});
