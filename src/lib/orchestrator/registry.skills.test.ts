/**
 * The skill actions (docs/skills.md). Writes go through the app server, so
 * `serverFetch` is replaced with a recorder here. What's under test is the
 * action surface itself: its shapes, who may call what, and how route
 * errors come back to an agent.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

const server = vi.hoisted(() => ({
  calls: [] as Array<{ path: string; method: string; body: unknown }>,
  reply: null as null | ((path: string) => unknown),
}));

vi.mock('./server-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./server-client')>();
  return {
    ...actual,
    serverFetch: vi.fn(async (p: string, init: RequestInit = {}) => {
      server.calls.push({ path: p, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : null });
      return server.reply ? server.reply(p) : { ok: true };
    }),
  };
});

let home: TestHome;
let userHome: string;
let savedHome: string | undefined;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-registry-skills-' });
  userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-registry-skills-home-'));
  savedHome = process.env.HOME;
  process.env.HOME = userHome;
  server.calls = [];
  server.reply = null;
});

afterEach(async () => {
  process.env.HOME = savedHome;
  fs.rmSync(userHome, { recursive: true, force: true });
  await home.cleanup();
});

async function action(name: string) {
  const { actions } = await import('./registry');
  const found = actions.find((a) => a.name === name);
  if (!found) throw new Error(`action ${name} missing`);
  return found;
}

const LOCAL = { remote: false } as const;
const HOME_MCP = { remote: true, caller: { location: 'home' as const } };
const ELSEWHERE = { remote: true, caller: { location: 'elsewhere' as const } };

async function seedSkill(name: string, reach?: 'off') {
  const { createSkill } = await import('@/lib/skills/library');
  createSkill({ name, description: `${name} does it.`, body: 'Steps.\n' });
  if (reach === 'off') (await import('@/lib/db/queries')).setSkillScope(name, []);
}

describe('skill actions', () => {
  it('are all registered', async () => {
    const { actions } = await import('./registry');
    expect(actions.map((a) => a.name)).toEqual(
      expect.arrayContaining(['list_skills', 'get_skill', 'create_skill', 'save_skill', 'set_skill_reach']),
    );
  });

  it('list_skills shows library skills with description and reach', async () => {
    await seedSkill('triage', 'off');
    const result = (await (await action('list_skills')).handler(LOCAL, {})) as Array<Record<string, unknown>>;
    expect(result).toEqual([
      expect.objectContaining({ name: 'triage', scope: 'global', description: 'triage does it.', reach: { mode: 'off' } }),
    ]);
  });

  it('get_skill returns the file, its parts and the hash to write against', async () => {
    await seedSkill('triage');
    const skill = (await (await action('get_skill')).handler(LOCAL, { name: 'triage' })) as Record<string, unknown>;
    expect(skill).toMatchObject({ name: 'triage', description: 'triage does it.', body: 'Steps.\n', reach: { mode: 'all' } });
    expect(skill.hash).toMatch(/^[0-9a-f]{16}$/);
    await expect((await action('get_skill')).handler(LOCAL, { name: 'nope' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('create_skill starts off, and a retry with the same content returns the same skill', async () => {
    const create = await action('create_skill');
    const first = (await create.handler(HOME_MCP, { name: 'triage', description: 'D.', body: 'B\n' })) as { reach: unknown };
    expect(first.reach).toEqual({ mode: 'off' });
    await expect(create.handler(HOME_MCP, { name: 'triage', description: 'D.', body: 'B\n' })).resolves.toMatchObject({ name: 'triage' });
    await expect(create.handler(HOME_MCP, { name: 'triage', description: 'Other.' })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('save_skill goes through the app server, and only from the home', async () => {
    await seedSkill('triage');
    const save = await action('save_skill');
    await save.handler(HOME_MCP, { name: 'triage', body: 'New.\n', baseHash: 'abc' });
    expect(server.calls).toEqual([{ path: '/skills/triage', method: 'PUT', body: { body: 'New.\n', baseHash: 'abc' } }]);
    await expect(save.handler(ELSEWHERE, { name: 'triage', body: 'x' })).rejects.toMatchObject({ code: 'unsupported' });
    expect(server.calls).toHaveLength(1);
  });

  it('save_skill tells an agent how to recover from a stale write', async () => {
    await seedSkill('triage');
    const { ServerResponseError } = await import('./server-client');
    server.reply = () => {
      throw new ServerResponseError(409, JSON.stringify({ error: 'triage changed since you last read it.', code: 'stale' }), 'PUT → 409');
    };
    await expect((await action('save_skill')).handler(LOCAL, { name: 'triage', body: 'x', baseHash: 'old' })).rejects.toMatchObject({
      code: 'conflict',
      message: 'triage changed since you last read it.',
      suggestion: expect.stringMatching(/get_skill/),
    });
  });

  it('save_skill treats a retried rename that already landed as done', async () => {
    await seedSkill('renamed');
    const { ServerResponseError } = await import('./server-client');
    server.reply = () => {
      throw new ServerResponseError(404, JSON.stringify({ error: "There's no skill named original.", code: 'not_found' }), 'PUT → 404');
    };
    const result = (await (await action('save_skill')).handler(LOCAL, { name: 'original', newName: 'renamed' })) as {
      renamedFrom: string;
      skill: { name: string };
    };
    expect(result).toMatchObject({ renamedFrom: 'original', skill: { name: 'renamed' } });
  });

  it('set_skill_reach lets MCP narrow but not widen', async () => {
    await seedSkill('triage', 'off');
    const set = await action('set_skill_reach');
    await expect(set.handler(HOME_MCP, { name: 'triage', mode: 'all' })).rejects.toMatchObject({ code: 'invalid_params' });
    expect(server.calls).toEqual([]);

    await set.handler(LOCAL, { name: 'triage', mode: 'all' });
    expect(server.calls).toEqual([{ path: '/skills/triage/reach', method: 'PUT', body: { mode: 'all' } }]);

    (await import('@/lib/db/queries')).clearSkillScope('triage');
    await set.handler(HOME_MCP, { name: 'triage', mode: 'off' });
    expect(server.calls.at(-1)).toEqual({ path: '/skills/triage/reach', method: 'PUT', body: { mode: 'off' } });
  });

  it('set_skill_reach answers not_found for a missing skill', async () => {
    await expect((await action('set_skill_reach')).handler(LOCAL, { name: 'nope', mode: 'off' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
