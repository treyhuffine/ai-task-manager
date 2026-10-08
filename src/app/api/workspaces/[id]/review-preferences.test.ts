import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb, resetDb } from '@/lib/db';
import { createChatSession, createWorkspace, getWorkspace, getUserState } from '@/lib/db/queries';
import { writeAuthConfig } from '@/lib/auth/config-file';
import { sessionCredential } from '@/lib/orchestrator/session-credential';
import { getWorkResultCapabilities } from '@/lib/work-results/capabilities';

const recycle = vi.hoisted(() => vi.fn());
const reconcile = vi.hoisted(() => vi.fn());
vi.mock('@/lib/work-results/automatic', () => ({ reconcileAutomaticWorkResultReviewPreferences: reconcile }));
vi.mock('@/lib/executor/adapter', () => ({ recycleWorkspaceSessions: recycle, recycleAgentMainChats: recycle }));
import { PATCH } from './route';

let root: string;
beforeEach(() => {
  resetDb();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-review-prefs-api-'));
  vi.stubEnv('RI_ROOT', root);
  vi.stubEnv('RI_DB_PATH', path.join(root, 'data.db'));
  vi.stubEnv('RI_CONFIG_DIR', path.join(root, 'config'));
  getDb();
  writeAuthConfig({ localToken: 'review-prefs-test' });
  recycle.mockClear();
  reconcile.mockClear();
});
afterEach(() => { resetDb(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

function patch(id: string, body: unknown, credential?: string | null) {
  return PATCH(new NextRequest(`http://localhost/api/workspaces/${id}`, {
    method: 'PATCH', body: JSON.stringify(body), headers: credential ? { 'x-ri-session': credential } : {},
  }), { params: Promise.resolve({ id }) });
}

describe('explicit agent review preference settings', () => {
  it('saves and resets preferences with both gates off without recycling authoring or changing normal settings', async () => {
    const ws = createWorkspace({ name: 'Research', cwd: root, isGit: false });
    const before = getUserState();
    expect((await patch(ws.id, { reviewBeforeHandoff: true, reviewDefaults: { harness: 'codex', model: 'gpt-5.5', effort: 'high' } })).status).toBe(200);
    expect(getWorkspace(ws.id)).toMatchObject({ reviewBeforeHandoff: true, reviewDefaults: { harness: 'codex', model: 'gpt-5.5', effort: 'high' } });
    expect(getWorkResultCapabilities()).toEqual({ handoffsEnabled: false, aiReviewEnabled: false });
    expect(getUserState()).toEqual(before);
    expect(recycle).not.toHaveBeenCalled();
    expect((await patch(ws.id, { reviewDefaults: null })).status).toBe(200);
    expect(getWorkspace(ws.id)).toMatchObject({ reviewBeforeHandoff: true, reviewDefaults: null });
  });

  it('immediately cancels queued policy work only when the automatic review preference is turned off', async () => {
    const ws = createWorkspace({ name: 'Research', cwd: root, isGit: false, reviewBeforeHandoff: true });
    await patch(ws.id, { reviewDefaults: { harness: 'codex' } });
    expect(reconcile).not.toHaveBeenCalled();
    await patch(ws.id, { reviewBeforeHandoff: false });
    expect(reconcile).toHaveBeenCalledWith(ws.id);
    reconcile.mockClear();
    await patch(ws.id, { reviewBeforeHandoff: null });
    expect(reconcile).toHaveBeenCalledWith(ws.id);
    reconcile.mockClear();
    await patch(ws.id, { reviewBeforeHandoff: true });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('rejects malformed preferences before committing any other fields', async () => {
    const ws = createWorkspace({ name: 'Research', cwd: root, isGit: false });
    const response = await patch(ws.id, { name: 'Mutated', reviewDefaults: { harness: 'invalid' } });
    expect(response.status).toBe(400);
    expect(getWorkspace(ws.id)).toMatchObject({ name: 'Research', reviewDefaults: null });
  });

  it('refuses signed authoring, reviewer, forged and foreign-owner session preference writes', async () => {
    const ws = createWorkspace({ name: 'Research', cwd: root, isGit: false });
    const author = createChatSession({ harness: 'claude', type: 'content', workspaceId: ws.id });
    const reviewer = createChatSession({ harness: 'claude', type: 'execution', workspaceId: ws.id, surfaceKind: 'result_review', surfaceRef: 'review' });
    const foreign = createChatSession({ userId: 'other', harness: 'claude', type: 'content', workspaceId: ws.id });
    for (const credential of [sessionCredential(author.id), sessionCredential(reviewer.id), 'forged.signature', sessionCredential(foreign.id)]) {
      const response = await patch(ws.id, { reviewDefaults: { harness: 'codex' } }, credential);
      expect([403, 404]).toContain(response.status);
    }
    expect(getWorkspace(ws.id)?.reviewDefaults).toBeNull();
  });
});
