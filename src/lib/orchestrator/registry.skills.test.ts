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
let project: string;
let wsId: string;
let savedHome: string | undefined;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-registry-skills-' });
  userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-registry-skills-home-'));
  project = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-registry-skills-project-'));
  savedHome = process.env.HOME;
  process.env.HOME = userHome;
  const q = await import('@/lib/db/queries');
  wsId = q.createWorkspace({ name: 'Blog', cwd: project, isGit: false, filesToCopy: [], status: 'active' }).id;
  server.calls = [];
  server.reply = null;
});

afterEach(async () => {
  process.env.HOME = savedHome;
  fs.rmSync(userHome, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
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

async function seed(dir: string, name: string) {
  const { createSkillAt } = await import('@/lib/skills/library');
  createSkillAt(path.join(dir, name), { description: `${name} does it.`, body: 'Steps.\n' });
}

describe('skill actions', () => {
  it('are all registered', async () => {
    const { actions } = await import('./registry');
    expect(actions.map((a) => a.name)).toEqual(
      expect.arrayContaining(['list_skills', 'get_skill', 'create_skill', 'save_skill', 'move_skill']),
    );
    expect(actions.map((a) => a.name)).not.toContain('set_skill_reach');
  });

  it('list_skills shows every place, or only what a chat in one folder gets', async () => {
    await seed(path.join(home.root, 'skills'), 'weekly-review');
    await seed(path.join(userHome, '.claude', 'skills'), 'implementing-specs');
    await seed(path.join(project, '.claude', 'skills'), 'deploy');
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-registry-skills-other-'));
    try {
      const all = (await (await action('list_skills')).handler(LOCAL, {})) as Array<Record<string, unknown>>;
      expect(all).toEqual([
        expect.objectContaining({ ref: 'ri:weekly-review', location: 'ri', description: 'weekly-review does it.' }),
        expect.objectContaining({ ref: 'global:implementing-specs', location: 'global' }),
        expect.objectContaining({ ref: `project:${wsId}:deploy`, location: 'project', project: 'Blog' }),
      ]);
      const elsewhere = (await (await action('list_skills')).handler(LOCAL, { workspaceCwd: other })) as Array<{ ref: string }>;
      expect(elsewhere.map((s) => s.ref)).toEqual(['ri:weekly-review', 'global:implementing-specs']);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it('get_skill returns the file, its parts and the hash to write against', async () => {
    await seed(path.join(home.root, 'skills'), 'triage');
    const skill = (await (await action('get_skill')).handler(LOCAL, { ref: 'triage' })) as Record<string, unknown>;
    expect(skill).toMatchObject({ ref: 'ri:triage', location: 'ri', description: 'triage does it.', body: 'Steps.\n', editable: true });
    expect(skill.hash).toMatch(/^[0-9a-f]{16}$/);
    await expect((await action('get_skill')).handler(LOCAL, { ref: 'ri:nope' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('create_skill puts it in Ri, and a retry with the same content returns the same skill', async () => {
    const create = await action('create_skill');
    const first = (await create.handler(HOME_MCP, { name: 'triage', description: 'D.', body: 'B\n' })) as { ref: string };
    expect(first.ref).toBe('ri:triage');
    await expect(create.handler(HOME_MCP, { name: 'triage', description: 'D.', body: 'B\n' })).resolves.toMatchObject({ ref: 'ri:triage' });
    await expect(create.handler(HOME_MCP, { name: 'triage', description: 'Other.' })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('create_skill outside Ri is the local CLI or app only', async () => {
    const create = await action('create_skill');
    await expect(create.handler(HOME_MCP, { name: 'g', location: 'global' })).rejects.toMatchObject({ code: 'invalid_params' });
    const made = (await create.handler(LOCAL, { name: 'p', location: 'project', workspaceId: wsId })) as { ref: string };
    expect(made.ref).toBe(`project:${wsId}:p`);
    await expect(create.handler(LOCAL, { name: 'q', location: 'project' })).rejects.toMatchObject({ code: 'invalid_params' });
  });

  it('save_skill goes through the app server, and only from the home', async () => {
    await seed(path.join(home.root, 'skills'), 'triage');
    const save = await action('save_skill');
    await save.handler(HOME_MCP, { ref: 'ri:triage', body: 'New.\n', baseHash: 'abc' });
    expect(server.calls).toEqual([{ path: '/skills/ri%3Atriage', method: 'PUT', body: { body: 'New.\n', baseHash: 'abc' } }]);
    await expect(save.handler(ELSEWHERE, { ref: 'ri:triage', body: 'x' })).rejects.toMatchObject({ code: 'unsupported' });
    expect(server.calls).toHaveLength(1);
  });

  it('save_skill tells an agent how to recover from a stale write', async () => {
    const { ServerResponseError } = await import('./server-client');
    server.reply = () => {
      throw new ServerResponseError(409, JSON.stringify({ error: 'triage changed since you last read it.', code: 'stale' }), 'PUT → 409');
    };
    await expect((await action('save_skill')).handler(LOCAL, { ref: 'ri:triage', body: 'x', baseHash: 'old' })).rejects.toMatchObject({
      code: 'conflict',
      message: 'triage changed since you last read it.',
      suggestion: expect.stringMatching(/get_skill/),
    });
  });

  it('save_skill treats a retried rename that already landed as done', async () => {
    await seed(path.join(home.root, 'skills'), 'renamed');
    const { ServerResponseError } = await import('./server-client');
    server.reply = () => {
      throw new ServerResponseError(404, JSON.stringify({ error: "There's no such skill.", code: 'not_found' }), 'PUT → 404');
    };
    const result = (await (await action('save_skill')).handler(LOCAL, { ref: 'ri:original', newName: 'renamed' })) as {
      renamedFrom: string;
      skill: { ref: string };
    };
    expect(result).toMatchObject({ renamedFrom: 'ri:original', skill: { ref: 'ri:renamed' } });
  });

  it('move_skill is the local CLI or app only, and goes through the app server', async () => {
    const move = await action('move_skill');
    await expect(move.handler(HOME_MCP, { ref: 'ri:x', to: 'global' })).rejects.toMatchObject({ code: 'invalid_params' });
    expect(server.calls).toEqual([]);
    await move.handler(LOCAL, { ref: 'ri:x', to: 'project', workspaceId: wsId, copy: true });
    expect(server.calls).toEqual([
      { path: '/skills/ri%3Ax/move', method: 'POST', body: { to: 'project', workspaceId: wsId, copy: true } },
    ]);
  });
});
