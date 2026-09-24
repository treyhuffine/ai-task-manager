import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { API_KEY_ID_HEADER, API_KEY_TYPE_HEADER } from '@/lib/auth/request-key';

/**
 * A connected computer's CLI runs actions on its home through this route,
 * with provenance from credentials only (docs/homes-spec.md §5.3, §6).
 */

let home: TestHome;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-actions-route-' });
});

afterEach(async () => {
  await home.cleanup();
});

function post(name: string, body: unknown, headers: Record<string, string>) {
  return new NextRequest(`http://127.0.0.1/api/orchestrator/actions/${name}`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const fromLaptop = { [API_KEY_ID_HEADER]: 'key-laptop', [API_KEY_TYPE_HEADER]: 'computer' };
const fromHome = { [API_KEY_ID_HEADER]: 'key-host', [API_KEY_TYPE_HEADER]: 'host' };

async function call(name: string, body: unknown, headers: Record<string, string>) {
  const { POST } = await import('./route');
  const res = await POST(post(name, body, headers), { params: Promise.resolve({ name }) });
  return { status: res.status, body: (await res.json()) as { ok: boolean; result?: any; error?: any } };
}

describe('POST /api/orchestrator/actions/:name', () => {
  it('runs the action on the home and returns the CLI envelope', async () => {
    const { status, body } = await call('create_task', { title: 'Buy milk' }, fromLaptop);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.result.title).toBe('Buy milk');
    const { listTasks } = await import('@/lib/db/queries');
    expect(listTasks({}).map((t) => t.title)).toContain('Buy milk');
  });

  it('returns validation and unknown-action failures in the same envelope', async () => {
    expect((await call('create_task', {}, fromLaptop)).body.error.code).toBe('invalid_params');
    expect((await call('no_such_action', {}, fromLaptop)).body.error.code).toBe('unknown_action');
    const bad = await call('create_task', '{not json', fromLaptop);
    expect(bad.status).toBe(400);
  });

  it('attributes a lifecycle change to the calling session, from its signed credential only', async () => {
    const q = await import('@/lib/db/queries');
    const { sessionCredential } = await import('@/lib/orchestrator/session-credential');
    const chat = q.createChatSession({ type: 'orchestration', harness: 'claude', status: 'active' });
    const task = q.createTask({ title: 'Ship it' });

    const started = await call('transition_task', { id: task.id, command: 'start' }, {
      ...fromLaptop,
      'x-ri-session': sessionCredential(chat.id)!,
    });
    expect(started.body.ok).toBe(true);
    const { getRawDb } = await import('@/lib/db');
    const change = getRawDb()
      .prepare('SELECT actor_session_id, actor_source FROM task_status_changes WHERE task_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(task.id) as { actor_session_id: string | null; actor_source: string };
    expect(change).toEqual({ actor_session_id: chat.id, actor_source: 'ai' });

    // A forged credential names no one.
    const forged = await call('get_task', { id: task.id }, { ...fromLaptop, 'x-ri-session': `${chat.id}.forged` });
    expect(forged.body.ok).toBe(true);
  });

  it("refuses a folder path from another computer, which would name a folder on the home's disk", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-actions-folder-'));
    try {
      const fromElsewhere = await call('create_workspace', { name: 'app', cwd: folder }, fromLaptop);
      expect(fromElsewhere.body.ok).toBe(false);
      expect(fromElsewhere.body.error.code).toBe('unsupported');
      expect(fromElsewhere.body.error.message).toMatch(/another computer/);

      const onHome = await call('create_workspace', { name: 'app', cwd: folder }, fromHome);
      expect(onHome.body.ok).toBe(true);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});
