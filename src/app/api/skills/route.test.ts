/**
 * Skills over HTTP: the contract the app and the orchestrator actions share.
 * Status codes, refs in the path, the stale-write answer, moving, and
 * committing a project skill. The logic itself is covered in src/lib/skills.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import { setSkillSessionControlForTests } from '@/lib/skills/manage';
import { GET as list, POST as create } from './route';
import { DELETE as archive, GET as read, PUT as save } from './[ref]/route';
import { POST as move } from './[ref]/move/route';
import { POST as commit } from './[ref]/commit/route';

let home: TestHome;
let userHome: string;
let repo: string;
let wsId: string;
let saved: Record<string, string | undefined>;
const IDENTITY = { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@e.co', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@e.co' };

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-skills-route-' });
  userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-skills-route-home-'));
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-skills-route-repo-'));
  saved = { HOME: process.env.HOME, ...Object.fromEntries(Object.keys(IDENTITY).map((k) => [k, process.env[k]])) };
  process.env.HOME = userHome;
  Object.assign(process.env, IDENTITY);
  execFileSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: repo });
  execFileSync('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: repo });
  wsId = q.createWorkspace({ name: 'Blog', cwd: repo, isGit: true, filesToCopy: [], status: 'active' }).id;
  setSkillSessionControlForTests({ close: vi.fn(async () => ({})), recycleWhenIdle: vi.fn(async () => {}) });
});

afterEach(async () => {
  setSkillSessionControlForTests(null);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(userHome, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
  await home.cleanup();
});

function json(method: string, body: unknown) {
  return new Request('http://test/api/skills', { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
}

const params = (ref: string) => ({ params: Promise.resolve({ ref }) });

describe('/api/skills', () => {
  it('creates a draft and lists it', async () => {
    const created = await create(json('POST', { intent: 'Review pull requests' }));
    expect(created.status).toBe(201);
    const { skill } = await created.json();
    expect(skill).toMatchObject({ ref: 'draft:review-pull-requests', location: { kind: 'draft' } });
    const overview = await (await list()).json();
    expect(overview.skills.map((s: { ref: string }) => s.ref)).toEqual(['draft:review-pull-requests']);
    expect(overview.projects).toEqual([expect.objectContaining({ workspaceId: wsId, name: 'Blog' })]);
  });

  it('hands New skill the same blank draft until something is in it', async () => {
    const first = (await (await create(json('POST', {}))).json()).skill;
    expect(first.ref).toBe('draft:new-skill');
    expect((await (await create(json('POST', {}))).json()).skill.ref).toBe('draft:new-skill');
    await save(json('PUT', { body: 'Steps.\n' }), params(first.ref));
    expect((await (await create(json('POST', {}))).json()).skill.ref).toBe('draft:new-skill-2');
  });

  it('can install right away, in Ri', async () => {
    const { skill } = await (await create(json('POST', { name: 'triage', description: 'T.', location: 'ri' }))).json();
    expect(skill).toMatchObject({ ref: 'ri:triage', location: { kind: 'ri' } });
  });

  it('creates in a project, and needs the agent for it', async () => {
    const created = await create(json('POST', { name: 'deploy', location: 'project', workspaceId: wsId }));
    expect((await created.json()).skill.ref).toBe(`project:${wsId}:deploy`);
    expect((await create(json('POST', { name: 'x', location: 'project' }))).status).toBe(400);
  });

  it('answers 400 for junk and a bad name, 409 for a taken one', async () => {
    expect((await create(new Request('http://test/api/skills', { method: 'POST', body: 'not json' }))).status).toBe(400);
    expect((await create(json('POST', { name: 'Bad Name' }))).status).toBe(400);
    expect((await create(json('POST', { name: 'taken' }))).status).toBe(201);
    const taken = await create(json('POST', { name: 'taken' }));
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ code: 'conflict' });
  });
});

describe('/api/skills/[ref]', () => {
  beforeEach(async () => {
    await create(json('POST', { name: 'triage', description: 'Triage the inbox.', body: 'Steps.\n', location: 'ri' }));
  });

  it('reads, saves and 404s', async () => {
    const { skill } = await (await read(new Request('http://test'), params('ri:triage'))).json();
    expect(skill).toMatchObject({ ref: 'ri:triage', body: 'Steps.\n', problems: [] });
    const saved = await (await save(json('PUT', { body: 'New.\n', baseHash: skill.hash }), params('ri:triage'))).json();
    expect(saved).toMatchObject({ skill: { body: 'New.\n' }, renamedFrom: null });
    expect((await read(new Request('http://test'), params('ri:nope'))).status).toBe(404);
    expect((await read(new Request('http://test'), params('ri:../escape'))).status).toBe(404);
  });

  it('answers a stale write with 409 and the current skill', async () => {
    const { skill } = await (await read(new Request('http://test'), params('ri:triage'))).json();
    await save(json('PUT', { body: 'Theirs.\n' }), params('ri:triage'));
    const stale = await save(json('PUT', { body: 'Mine.\n', baseHash: skill.hash }), params('ri:triage'));
    expect(stale.status).toBe(409);
    const body = await stale.json();
    expect(body.code).toBe('stale');
    expect(body.current.parsed.body).toBe('Theirs.\n');
  });

  it('renames through a save, and archives', async () => {
    const renamed = await (await save(json('PUT', { newName: 'inbox-triage' }), params('ri:triage'))).json();
    expect(renamed).toMatchObject({ skill: { ref: 'ri:inbox-triage' }, renamedFrom: 'ri:triage' });
    expect((await archive(new Request('http://test', { method: 'DELETE' }), params('ri:inbox-triage'))).status).toBe(200);
    expect((await read(new Request('http://test'), params('ri:inbox-triage'))).status).toBe(404);
  });
});

describe('installing, moving and committing', () => {
  it('installs a draft once nothing is flagged, and uninstalls it', async () => {
    await create(json('POST', { name: 'triage' }));
    const refused = await move(json('POST', { to: 'ri' }), params('draft:triage'));
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toMatch(/^Fix this before installing triage\./);
    await save(json('PUT', { description: 'Triages the inbox.' }), params('draft:triage'));
    const installed = await (await move(json('POST', { to: 'ri' }), params('draft:triage'))).json();
    expect(installed.skill).toMatchObject({ ref: 'ri:triage', location: { kind: 'ri' } });
    const back = await (await move(json('POST', { to: 'draft' }), params('ri:triage'))).json();
    expect(back.skill.ref).toBe('draft:triage');
  });

  it('moves to global, copies to a project and commits it there', async () => {
    await create(json('POST', { name: 'triage', description: 'Triage.', body: 'Steps.\n', location: 'ri' }));
    const moved = await (await move(json('POST', { to: 'global' }), params('ri:triage'))).json();
    expect(moved.skill.ref).toBe('global:triage');
    expect(fs.existsSync(path.join(userHome, '.claude', 'skills', 'triage', 'SKILL.md'))).toBe(true);

    const copied = await (await move(json('POST', { to: 'project', workspaceId: wsId, copy: true }), params('global:triage'))).json();
    expect(copied.skill).toMatchObject({ ref: `project:${wsId}:triage`, uncommitted: true });

    const done = await (await commit(new Request('http://test', { method: 'POST' }), params(`project:${wsId}:triage`))).json();
    expect(done).toMatchObject({ skill: { uncommitted: false }, commit: { branch: 'main', message: 'Add the triage skill' } });
  });

  it('answers 400 for a bad destination and a commit outside a project', async () => {
    await create(json('POST', { name: 'triage', description: 'Triage.', location: 'ri' }));
    expect((await move(json('POST', { to: 'sideways' }), params('ri:triage'))).status).toBe(400);
    expect((await move(json('POST', { to: 'ri' }), params('ri:triage'))).status).toBe(400);
    expect((await commit(new Request('http://test', { method: 'POST' }), params('ri:triage'))).status).toBe(400);
  });
});
