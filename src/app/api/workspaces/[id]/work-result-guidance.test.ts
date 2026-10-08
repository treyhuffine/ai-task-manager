import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb, resetDb } from '@/lib/db';
import { createChatSession, createWorkspace, getWorkspace, updateWorkspace, listWorkspaces } from '@/lib/db/queries';
import { writeAuthConfig } from '@/lib/auth/config-file';
import { sessionCredential } from '@/lib/orchestrator/session-credential';
import { WORK_RESULT_GUIDANCE_MAX } from '@/lib/instructions/preferences';

const recycleWorkspaceSessions = vi.hoisted(() => vi.fn());
const recycleAgentMainChats = vi.hoisted(() => vi.fn());
vi.mock('@/lib/executor/adapter', () => ({ recycleWorkspaceSessions, recycleAgentMainChats }));
import { PATCH } from './route';
import { POST as createAgent } from '../route';

let root: string;
beforeEach(() => {
  resetDb();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-local-workflow-guidance-api-'));
  vi.stubEnv('RI_ROOT', root);
  vi.stubEnv('RI_DB_PATH', path.join(root, 'data.db'));
  vi.stubEnv('RI_CONFIG_DIR', path.join(root, 'config'));
  getDb();
  writeAuthConfig({ localToken: 'local-workflow-guidance-test' });
  recycleWorkspaceSessions.mockClear();
  recycleAgentMainChats.mockClear();
});
afterEach(() => {
  resetDb();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

function create(guidance?: string | null) {
  return createWorkspace({ name: 'Research', cwd: root, isGit: false, workResultGuidance: guidance });
}

function patch(id: string, body: unknown, credential?: string | null) {
  return PATCH(new NextRequest(`http://localhost/api/workspaces/${id}`, {
    method: 'PATCH', body: JSON.stringify(body), headers: credential ? { 'x-ri-session': credential } : {},
  }), { params: Promise.resolve({ id }) });
}

describe('agent workflow guidance preferences', () => {
  it('cannot create remembered guidance or review policy through a signed session', async () => {
    const before = listWorkspaces();
    for (const preference of [{ workResultGuidance: 'Remember this.' }, { reviewBeforeHandoff: true }, { reviewDefaults: { harness: 'codex' } }]) {
      const response = await createAgent(new NextRequest('http://localhost/api/workspaces', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ri-session': 'forged.signature' },
        body: JSON.stringify({ name: 'Unauthorized new agent', cwd: root, isGit: false, ...preference }),
      }));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'unsupported' });
      expect(listWorkspaces()).toEqual(before);
    }
  });
  it('starts unset, normalizes create and save, and preserves existing chat instructions', async () => {
    const ws = create();
    expect(ws.workResultGuidance).toBeNull();
    expect(create('  Include the test evidence.\n ').workResultGuidance).toBe('Include the test evidence.');
    updateWorkspace(ws.id, { instructions: 'Standing agent instructions.', purpose: 'Explore options.' });

    const response = await patch(ws.id, { workResultGuidance: '\n Explain the handoff.\nInclude evidence.  ' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      workResultGuidance: 'Explain the handoff.\nInclude evidence.',
      instructions: 'Standing agent instructions.', purpose: 'Explore options.',
    });
    expect(recycleWorkspaceSessions).not.toHaveBeenCalled();
    expect(recycleAgentMainChats).not.toHaveBeenCalled();
  });

  it('preserves guidance on unrelated partial updates and normalized retries', async () => {
    const ws = create('Be concise.');
    expect((await patch(ws.id, { emoji: '🔎' })).status).toBe(200);
    expect(getWorkspace(ws.id)?.workResultGuidance).toBe('Be concise.');
    expect((await patch(ws.id, { workResultGuidance: '  Be concise.\n' })).status).toBe(200);
    expect(getWorkspace(ws.id)?.workResultGuidance).toBe('Be concise.');
    expect(recycleWorkspaceSessions).not.toHaveBeenCalled();
    expect(recycleAgentMainChats).not.toHaveBeenCalled();
  });

  it.each([null, '', ' ', '\n\t'])('clears guidance with %j without recycling chats', async (value) => {
    const ws = create('Previous preference.');
    expect((await patch(ws.id, { workResultGuidance: value })).status).toBe(200);
    expect(getWorkspace(ws.id)?.workResultGuidance).toBeNull();
    expect(recycleWorkspaceSessions).not.toHaveBeenCalled();
    expect(recycleAgentMainChats).not.toHaveBeenCalled();
  });

  it('rejects invalid text and oversize input before any API or query update writes', async () => {
    const ws = create('Keep this guidance.');
    const before = getWorkspace(ws.id);
    for (const workResultGuidance of [false, 1, [], {}, 'x'.repeat(WORK_RESULT_GUIDANCE_MAX + 1)]) {
      const response = await patch(ws.id, { name: 'Changed', workResultGuidance });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'invalid_params' });
      expect(() => updateWorkspace(ws.id, { name: 'Changed', workResultGuidance } as never)).toThrow();
      expect(getWorkspace(ws.id)).toEqual(before);
      expect(() => create(workResultGuidance as never)).toThrow();
    }
    expect((await patch(ws.id, { workResultGuidance: `\n${'x'.repeat(WORK_RESULT_GUIDANCE_MAX)}  ` })).status).toBe(200);
    expect(getWorkspace(ws.id)?.workResultGuidance).toHaveLength(WORK_RESULT_GUIDANCE_MAX);
    expect(recycleWorkspaceSessions).not.toHaveBeenCalled();
    expect(recycleAgentMainChats).not.toHaveBeenCalled();
  });

  it('rejects non-object settings and direct signed-session preference writes', async () => {
    const ws = create();
    for (const body of [null, [], 'text']) expect((await patch(ws.id, body)).status).toBe(400);
    const author = createChatSession({ harness: 'claude', type: 'content', workspaceId: ws.id });
    for (const credential of [sessionCredential(author.id), 'forged.signature']) {
      expect((await patch(ws.id, { workResultGuidance: 'Changed', name: 'Changed' }, credential)).status).toBe(403);
    }
    expect(getWorkspace(ws.id)).toMatchObject({ name: 'Research', workResultGuidance: null });
    expect(recycleWorkspaceSessions).not.toHaveBeenCalled();
    expect(recycleAgentMainChats).not.toHaveBeenCalled();
  });

  it('continues recycling live sessions when existing agent instructions change', async () => {
    const ws = create('Keep workflow evidence.');
    expect((await patch(ws.id, { instructions: 'Changed standing instructions.' })).status).toBe(200);
    expect(getWorkspace(ws.id)).toMatchObject({
      instructions: 'Changed standing instructions.', workResultGuidance: 'Keep workflow evidence.',
    });
    expect(recycleWorkspaceSessions).toHaveBeenCalledWith(ws.id);
    expect(recycleAgentMainChats).not.toHaveBeenCalled();
  });
});
