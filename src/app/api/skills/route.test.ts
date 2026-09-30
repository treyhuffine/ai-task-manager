/**
 * The skill library over HTTP: the contract the app and the orchestrator
 * actions share. Status codes, the stale-write answer, and the reach and
 * import routes. The library logic itself is covered in src/lib/skills.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { setSkillSessionControlForTests } from '@/lib/skills/manage';
import { GET as list, POST as create } from './route';
import { DELETE as archive, GET as read, PUT as save } from './[name]/route';
import { PUT as setReach } from './[name]/reach/route';
import { POST as importOutside } from './outside/import/route';

let home: TestHome;
let userHome: string;
let savedHome: string | undefined;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-skills-route-' });
  userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-skills-route-home-'));
  savedHome = process.env.HOME;
  process.env.HOME = userHome;
  setSkillSessionControlForTests({
    close: vi.fn(async () => ({})),
    recycleWhenIdle: vi.fn(async () => {}),
    recycleWorkspaceSessions: vi.fn(async () => {}),
    recycleEveryAgentSession: vi.fn(async () => {}),
  });
});

afterEach(async () => {
  setSkillSessionControlForTests(null);
  process.env.HOME = savedHome;
  fs.rmSync(userHome, { recursive: true, force: true });
  await home.cleanup();
});

function json(method: string, body: unknown) {
  return new Request('http://test/api/skills', { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
}

const params = (name: string) => ({ params: Promise.resolve({ name }) });

describe('/api/skills', () => {
  it('creates a skill off and lists it', async () => {
    const created = await create(json('POST', { intent: 'Review pull requests' }));
    expect(created.status).toBe(201);
    const { skill } = await created.json();
    expect(skill).toMatchObject({ name: 'review-pull-requests', reach: { mode: 'off' } });

    const overview = await (await list(new Request('http://test/api/skills'))).json();
    expect(overview.skills).toEqual([expect.objectContaining({ name: 'review-pull-requests', reach: { mode: 'off' } })]);
    expect(overview.canReachOutside).toBe(true);
  });

  it('answers 400 for junk and a bad name, 409 for a taken one', async () => {
    const junk = await create(new Request('http://test/api/skills', { method: 'POST', body: 'not json' }));
    expect(junk.status).toBe(400);
    expect((await create(json('POST', { name: 'Bad Name' }))).status).toBe(400);
    expect((await create(json('POST', { name: 'taken' }))).status).toBe(201);
    const taken = await create(json('POST', { name: 'taken' }));
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ code: 'conflict' });
  });
});

describe('/api/skills/[name]', () => {
  beforeEach(async () => {
    await create(json('POST', { name: 'triage', description: 'Triage the inbox.', body: 'Steps.\n' }));
  });

  it('reads, saves and 404s', async () => {
    const { skill } = await (await read(new Request('http://test'), params('triage'))).json();
    expect(skill).toMatchObject({ name: 'triage', body: 'Steps.\n', problems: [] });
    const saved = await (await save(json('PUT', { body: 'New.\n', baseHash: skill.hash }), params('triage'))).json();
    expect(saved).toMatchObject({ skill: { body: 'New.\n' }, renamedFrom: null });
    expect((await read(new Request('http://test'), params('nope'))).status).toBe(404);
  });

  it('answers a stale write with 409 and the current skill', async () => {
    const { skill } = await (await read(new Request('http://test'), params('triage'))).json();
    await save(json('PUT', { body: 'Theirs.\n' }), params('triage'));
    const stale = await save(json('PUT', { body: 'Mine.\n', baseHash: skill.hash }), params('triage'));
    expect(stale.status).toBe(409);
    const body = await stale.json();
    expect(body.code).toBe('stale');
    expect(body.current.parsed.body).toBe('Theirs.\n');
  });

  it('renames through a save', async () => {
    const renamed = await (await save(json('PUT', { newName: 'inbox-triage' }), params('triage'))).json();
    expect(renamed).toMatchObject({ skill: { name: 'inbox-triage' }, renamedFrom: 'triage' });
  });

  it('archives', async () => {
    const res = await archive(new Request('http://test', { method: 'DELETE' }), params('triage'));
    expect(res.status).toBe(200);
    expect((await read(new Request('http://test'), params('triage'))).status).toBe(404);
  });
});

describe('/api/skills/[name]/reach', () => {
  it('turns a skill on and off, and refuses an unfinished one', async () => {
    await create(json('POST', { name: 'triage', description: 'Triage.', body: 'Steps.\n' }));
    const on = await (await setReach(json('PUT', { mode: 'all' }), params('triage'))).json();
    expect(on.skill.reach).toEqual({ mode: 'all' });
    const everywhere = await (await setReach(json('PUT', { mode: 'everywhere' }), params('triage'))).json();
    expect(everywhere.skill.reach).toEqual({ mode: 'everywhere' });
    expect(fs.existsSync(path.join(userHome, '.claude', 'skills', 'triage'))).toBe(true);

    await create(json('POST', { name: 'unfinished' }));
    const refused = await setReach(json('PUT', { mode: 'all' }), params('unfinished'));
    expect(refused.status).toBe(400);
    expect((await setReach(json('PUT', { mode: 'sideways' }), params('triage'))).status).toBe(400);
  });
});

describe('/api/skills/outside/import', () => {
  it('imports a skill from ~/.claude/skills, and 404s an unknown one', async () => {
    const theirs = path.join(userHome, '.claude', 'skills', 'implementing-specs');
    fs.mkdirSync(theirs, { recursive: true });
    fs.writeFileSync(path.join(theirs, 'SKILL.md'), '---\nname: implementing-specs\ndescription: Specs.\n---\nBody\n');
    const res = await importOutside(json('POST', { name: 'implementing-specs' }));
    expect(res.status).toBe(201);
    expect((await res.json()).skill).toMatchObject({ name: 'implementing-specs', reach: { mode: 'everywhere' } });
    expect((await importOutside(json('POST', { name: 'nope' }))).status).toBe(404);
  });
});
