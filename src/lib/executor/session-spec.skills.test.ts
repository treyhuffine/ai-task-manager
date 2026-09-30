/**
 * What the home tells a runner about skills (docs/skills.md): the builder
 * chat's brief, and the library skills each chat leaves out, carried on the
 * spec because the runner may be on a device without the database.
 */

import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import * as q from '@/lib/db/queries';
import { createSkill } from '@/lib/skills/library';
import { buildSessionSpec, type SessionSpecInput } from './session-spec';

let home: TestHome;
let fake: FakeHarness;
let wsA: string;
let wsB: string;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-spec-skills-' });
  fake = installFakeHarness('claude');
  wsA = q.createWorkspace({ name: 'A', cwd: path.join(home.root, 'a'), isGit: false, filesToCopy: [], status: 'active' }).id;
  wsB = q.createWorkspace({ name: 'B', cwd: path.join(home.root, 'b'), isGit: false, filesToCopy: [], status: 'active' }).id;
  createSkill({ name: 'drafting', description: 'Being written.', body: 'x\n' });
  createSkill({ name: 'only-a', description: 'For A.', body: 'x\n' });
  createSkill({ name: 'everyone', description: 'For all.', body: 'x\n' });
  q.setSkillScope('drafting', []);
  q.setSkillScope('only-a', [wsA]);
});

afterEach(async () => {
  fake.restore();
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
  it("leaves off and other agents' skills out of the app's main chat", async () => {
    const spec = await buildSessionSpec(input({}));
    expect(spec.excludeSkills).toEqual(['drafting', 'only-a']);
  });

  it("gives an agent's execution the skills scoped to it", async () => {
    const forA = await buildSessionSpec(input({ sessionType: 'execution', workspaceId: wsA, cwd: path.join(home.root, 'a') }));
    const forB = await buildSessionSpec(input({ sessionType: 'execution', workspaceId: wsB, cwd: path.join(home.root, 'b') }));
    expect(forA.excludeSkills).toEqual(['drafting']);
    expect(forB.excludeSkills).toEqual(['drafting', 'only-a']);
  });

  it('briefs a builder chat on its skill, and keeps that skill away from it', async () => {
    const spec = await buildSessionSpec(input({ sessionType: 'content', surfaceKind: 'skill', surfaceRef: 'everyone' }));
    expect(spec.instructions).toContain('# Writing the "everyone" skill');
    expect(spec.instructions).toContain('get_skill');
    expect(spec.excludeSkills).toEqual(['drafting', 'everyone', 'only-a']);
  });

  it('gives a try chat the skill it tries, even while it is off', async () => {
    const spec = await buildSessionSpec(input({ sessionType: 'content', surfaceKind: 'skill-try', surfaceRef: 'drafting' }));
    expect(spec.excludeSkills).toEqual(['only-a']);
    expect(spec.instructions ?? '').not.toContain('Writing the');
  });

  it('leaves the field unset when nothing is excluded', async () => {
    q.clearSkillScope('drafting');
    q.clearSkillScope('only-a');
    const spec = await buildSessionSpec(input({}));
    expect(spec.excludeSkills).toBeUndefined();
  });
});
