import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { getDb, resetDb } from '@/lib/db';
import { getUserState, updateUserState } from '@/lib/db/queries';
import { writeAuthConfig } from '@/lib/auth/config-file';
import { SESSION_CREDENTIAL_HEADER } from '@/lib/orchestrator/session-credential';
import { WORK_RESULT_GUIDANCE_MAX } from '@/lib/instructions/preferences';
import { PATCH } from './route';

const recycle = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/lib/executor/adapter', () => ({ recycleWorkspaceSessions: recycle, recycleAgentMainChats: recycle }));

let root: string;
const originalRoot = process.env.RI_ROOT;
const originalDb = process.env.RI_DB_PATH;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-shared-workflow-guidance-api-'));
  process.env.RI_ROOT = root;
  process.env.RI_DB_PATH = path.join(root, 'data.db');
  resetDb();
  getDb();
  writeAuthConfig({ localToken: 'shared-workflow-guidance-test-host' });
  recycle.mockReset();
  recycle.mockResolvedValue(undefined);
});

afterEach(() => {
  resetDb();
  fs.rmSync(root, { recursive: true, force: true });
  if (originalRoot === undefined) delete process.env.RI_ROOT;
  else process.env.RI_ROOT = originalRoot;
  if (originalDb === undefined) delete process.env.RI_DB_PATH;
  else process.env.RI_DB_PATH = originalDb;
});

function patch(body: unknown, credential?: string) {
  return PATCH(new NextRequest('http://localhost/api/user-state', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(credential ? { [SESSION_CREDENTIAL_HEADER]: credential } : {}) },
    body: JSON.stringify(body),
  }));
}

describe('shared workflow guidance', () => {
  it('starts unset and preserves About you and normal settings', async () => {
    expect(getUserState()?.workResultGuidance).toBeNull();
    updateUserState({ description: 'Founder', defaultEffort: 'high' });
    const response = await patch({ workResultGuidance: '\n Keep handoffs brief.\nInclude evidence.  ' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      workResultGuidance: 'Keep handoffs brief.\nInclude evidence.', description: 'Founder', defaultEffort: 'high',
    });
    expect(recycle).not.toHaveBeenCalled();
  });

  it('preserves guidance through unrelated settings edits and unchanged retries', async () => {
    updateUserState({ workResultGuidance: 'Be concise.' });
    expect((await patch({ name: 'Trey' })).status).toBe(200);
    expect(getUserState()?.workResultGuidance).toBe('Be concise.');
    expect((await patch({ workResultGuidance: '  Be concise.\n' })).status).toBe(200);
    expect(recycle).not.toHaveBeenCalled();
  });

  it.each([null, ' ', '\n\t'])('clears inherited guidance with %j', async (value) => {
    updateUserState({ workResultGuidance: 'Old preference.' });
    expect((await patch({ workResultGuidance: value })).status).toBe(200);
    expect(getUserState()?.workResultGuidance).toBeNull();
    expect(recycle).not.toHaveBeenCalled();
  });

  it('checks text and size before committing any submitted setting', async () => {
    updateUserState({ name: 'Original', workResultGuidance: 'Original guidance.' });
    const before = getUserState();
    for (const workResultGuidance of [false, 1, [], {}, 'x'.repeat(WORK_RESULT_GUIDANCE_MAX + 1)]) {
      expect((await patch({ name: 'Changed', workResultGuidance })).status).toBe(400);
      expect(() => updateUserState({ name: 'Changed', workResultGuidance } as never)).toThrow();
      expect(getUserState()).toEqual(before);
    }
    expect((await patch({ workResultGuidance: `  ${'x'.repeat(WORK_RESULT_GUIDANCE_MAX)}\n` })).status).toBe(200);
    expect(getUserState()?.workResultGuidance).toHaveLength(WORK_RESULT_GUIDANCE_MAX);
    expect(recycle).not.toHaveBeenCalled();
  });

  it('rejects non-object input and signed-session preference writes', async () => {
    for (const body of [null, [], 'text']) expect((await patch(body)).status).toBe(400);
    const response = await patch({ workResultGuidance: 'Changed', name: 'Changed' }, 'forged.signature');
    expect(response.status).toBe(403);
    expect(getUserState()).toMatchObject({ name: null, workResultGuidance: null });
    expect(recycle).not.toHaveBeenCalled();
  });

});
