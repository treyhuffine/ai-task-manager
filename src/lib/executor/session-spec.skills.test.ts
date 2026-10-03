/**
 * What the home tells a runner about skills (docs/skills.md): the builder
 * chat's brief, the Ri skill it leaves out, and the project skill a try chat
 * attaches, carried on the spec because the runner may be on a device
 * without the database.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import * as q from '@/lib/db/queries';
import { createSkillAt } from '@/lib/skills/library';
import { buildSessionSpec, type SessionSpecInput } from './session-spec';

let home: TestHome;
let fake: FakeHarness;
let project: string;
let wsId: string;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-spec-skills-' });
  fake = installFakeHarness('claude');
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-spec-skills-project-'));
  wsId = q.createWorkspace({ name: 'Blog', cwd: project, isGit: false, filesToCopy: [], status: 'active' }).id;
  createSkillAt(path.join(home.root, 'skills', 'weekly-review'), { description: 'Reviews the week.', body: 'x\n' });
  createSkillAt(path.join(project, '.claude', 'skills', 'deploy'), { description: 'Deploys.', body: 'x\n' });
  createSkillAt(path.join(home.root, 'skill-drafts', 'idea'), { description: 'An idea.', body: 'x\n' });
});

afterEach(async () => {
  fake.restore();
  fs.rmSync(project, { recursive: true, force: true });
  await home.cleanup();
});

function input(over: Partial<SessionSpecInput>): SessionSpecInput {
  return {
    chatSessionId: q.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active' }).id,
    harness: 'claude',
    cwd: home.root,
    sessionType: 'orchestration',
    workspaceId: null,
    surfaceKind: null,
    surfaceRef: null,
    existingExternalSessionId: null,
    permissionMode: 'auto_all',
    prePlanMode: null,
    model: null,
    modelVariant: null,
    effort: null,
    ...over,
  };
}

describe('skills on the session spec', () => {
  it('adds nothing for an ordinary chat', async () => {
    const spec = await buildSessionSpec(input({}));
    expect(spec.excludeSkills).toBeUndefined();
    expect(spec.extraSkillDirs).toBeUndefined();
  });

  it('briefs a builder chat on its skill, and keeps that Ri skill away from it', async () => {
    const spec = await buildSessionSpec(input({ sessionType: 'content', surfaceKind: 'skill', surfaceRef: 'ri:weekly-review' }));
    expect(spec.instructions).toContain('# Writing the "weekly-review" skill');
    expect(spec.instructions).toContain('get_skill` (ref "ri:weekly-review")');
    expect(spec.instructions).toContain('every chat Ri runs uses it');
    expect(spec.excludeSkills).toEqual(['weekly-review']);
  });

  it("tells a project skill's builder where it lives", async () => {
    const spec = await buildSessionSpec(input({ sessionType: 'content', surfaceKind: 'skill', surfaceRef: `project:${wsId}:deploy` }));
    expect(spec.instructions).toContain(`the Blog project (${project}/.claude/skills)`);
    expect(spec.excludeSkills).toBeUndefined();
  });

  it('gives a try chat the project skill it tries', async () => {
    const spec = await buildSessionSpec(input({ sessionType: 'content', surfaceKind: 'skill-try', surfaceRef: `project:${wsId}:deploy` }));
    expect(spec.extraSkillDirs).toEqual([path.join(project, '.claude', 'skills', 'deploy')]);
    expect(spec.instructions ?? '').not.toContain('Writing the');
  });

  it("tells a draft's builder it isn't installed yet, and how to install it when asked", async () => {
    const spec = await buildSessionSpec(input({ sessionType: 'content', surfaceKind: 'skill', surfaceRef: 'draft:idea' }));
    expect(spec.instructions).toContain('It is a draft: written here but not installed, so no agent uses it yet.');
    expect(spec.instructions).toContain('Install it with `move_skill` (ref\n"draft:idea")');
    expect(spec.instructions).toContain('Only install when the user asks or agrees');
    expect(spec.excludeSkills).toBeUndefined();
  });

  it('gives a try chat the draft it tries, which nothing else reads', async () => {
    const spec = await buildSessionSpec(input({ sessionType: 'content', surfaceKind: 'skill-try', surfaceRef: 'draft:idea' }));
    expect(spec.extraSkillDirs).toEqual([path.join(home.root, 'skill-drafts', 'idea')]);
  });

  it("needs nothing extra to try a Ri skill, which every chat already gets", async () => {
    const spec = await buildSessionSpec(input({ sessionType: 'content', surfaceKind: 'skill-try', surfaceRef: 'ri:weekly-review' }));
    expect(spec.extraSkillDirs).toBeUndefined();
    expect(spec.excludeSkills).toBeUndefined();
  });
});
