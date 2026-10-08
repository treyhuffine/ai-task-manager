import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WORK_RESULT_GUIDANCE_MAX } from '@/lib/instructions/preferences';

vi.mock('@/lib/executor/adapter', () => ({
  recycleWorkspaceSessions: vi.fn(async () => {}),
  recycleAgentMainChats: vi.fn(async () => {}),
}));
vi.mock('./server-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('./server-client')>();
  return { ...original, serverFetch: async (target: string, init: RequestInit = {}) => {
    const match = /^\/workspaces\/([^/]+)$/.exec(target);
    if (!match) throw new Error(`Unexpected guidance server path: ${target}`);
    const { PATCH } = await import('@/app/api/workspaces/[id]/route');
    const response = await PATCH(new Request(`http://localhost/api${target}`, {
      ...init, headers: { 'Content-Type': 'application/json', ...init.headers },
    }) as never, { params: Promise.resolve({ id: match[1] }) });
    if (!response.ok) throw new original.ServerResponseError(response.status, await response.text(), 'Guidance update failed.');
    return response.json();
  } };
});

let root: string;
const saved = new Map<string, string | undefined>();
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-work-result-guidance-actions-'));
  for (const key of ['RI_ROOT', 'RI_DB_PATH', 'RI_MIRROR_DISABLED']) saved.set(key, process.env[key]);
  process.env.RI_ROOT = root;
  process.env.RI_DB_PATH = path.join(root, 'data.db');
  process.env.RI_MIRROR_DISABLED = '1';
  vi.resetModules();
  const { resetDb } = await import('@/lib/db');
  resetDb();
  const { writeAuthConfig } = await import('@/lib/auth/config-file');
  writeAuthConfig({ localToken: 'guidance-actions-fixture-token', handoffsEnabled: true });
});
afterEach(async () => {
  const { resetDb } = await import('@/lib/db');
  resetDb();
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

function caller(sessionId: string) {
  return { remote: true, actor: { source: 'ai' as const, sessionId } };
}

describe('scoped handoff context', () => {
  it('resolves current shared and own-agent guidance without writes or caller-selected scope', async () => {
    const q = await import('@/lib/db/queries');
    const { runAction } = await import('./dispatch');
    q.updateUserState({ workResultGuidance: 'Shared: lead with decisions.' });
    const own = q.createWorkspace({ name: 'Own', cwd: root, isGit: false, workResultGuidance: 'Local: show preview first.' });
    const other = q.createWorkspace({ name: 'Other', cwd: root, isGit: false, workResultGuidance: 'Secret other preferences.' });
    const session = q.createChatSession({ type: 'orchestration', harness: 'claude', workspaceId: own.id });
    const before = q.getUserState();
    const response = await runAction('get_handoff_context', {}, caller(session.id));
    expect(response).toMatchObject({ ok: true, result: {
      sharedGuidance: 'Shared: lead with decisions.', agentGuidance: 'Local: show preview first.',
      agent: { id: own.id, name: 'Own' },
    } });
    const instructions = (response.result as { instructions: string }).instructions;
    expect(instructions).toContain('report_result');
    expect(instructions).toContain('Shared: lead with decisions.');
    expect(instructions).toContain('Local: show preview first.');
    expect(instructions).not.toContain('Secret other preferences.');
    expect(q.getUserState()).toEqual(before);
    expect(q.listWorkResults()).toEqual([]);
    expect((await runAction('get_handoff_context', { workspace_id: other.id }, caller(session.id))).error?.code).toBe('invalid_params');
    q.updateUserState({ workResultGuidance: null });
    q.updateWorkspace(own.id, { workResultGuidance: 'New local preference.' });
    expect(await runAction('get_handoff_context', {}, caller(session.id))).toMatchObject({
      ok: true, result: { sharedGuidance: null, agentGuidance: 'New local preference.' },
    });
  });

  it('gives taskless app chats shared guidance and rejects unsigned, missing or inactive producers', async () => {
    const q = await import('@/lib/db/queries');
    const { runAction } = await import('./dispatch');
    q.updateUserState({ workResultGuidance: 'Shared guidance.' });
    const session = q.createChatSession({ type: 'orchestration', harness: 'claude' });
    expect(await runAction('get_handoff_context', {}, caller(session.id))).toMatchObject({
      ok: true, result: { sharedGuidance: 'Shared guidance.', agentGuidance: null, agent: null },
    });
    expect((await runAction('get_handoff_context', {}, { remote: false })).error?.code).toBe('unsupported');
    expect((await runAction('get_handoff_context', {}, caller('missing'))).error?.code).toBe('not_found');
    q.updateChatSession(session.id, { status: 'archived' });
    expect((await runAction('get_handoff_context', {}, caller(session.id))).error?.code).toBe('unsupported');
  });

  it('disables new context reads when handoffs are off and confines reviewers', async () => {
    const q = await import('@/lib/db/queries');
    const { runAction } = await import('./dispatch');
    const { setWorkResultCapabilities } = await import('@/lib/work-results/capabilities');
    const session = q.createChatSession({ type: 'orchestration', harness: 'claude' });
    const reviewer = q.createChatSession({ type: 'execution', harness: 'claude', surfaceKind: 'result_review', surfaceRef: 'review-fixture' });
    expect((await runAction('get_handoff_context', {}, caller(reviewer.id))).error?.code).toBe('unsupported');
    setWorkResultCapabilities({ handoffsEnabled: false });
    expect((await runAction('get_handoff_context', {}, caller(session.id))).error?.code).toBe('unsupported');
  });
});

describe('explicitly remembered workflow guidance', () => {
  it('lets the app main chat remember and clear shared guidance while preserving normal settings', async () => {
    const q = await import('@/lib/db/queries');
    const { runAction } = await import('./dispatch');
    q.updateUserState({ defaultEffort: 'high', description: 'Existing profile.' });
    const main = q.createChatSession({ type: 'orchestration', harness: 'claude' });
    expect(await runAction('update_user_state', { work_result_guidance: '  Show useful links.  ' }, caller(main.id))).toMatchObject({
      ok: true, result: { workResultGuidance: 'Show useful links.', defaultEffort: 'high', description: 'Existing profile.' },
    });
    expect(await runAction('update_user_state', { work_result_guidance: null }, caller(main.id))).toMatchObject({
      ok: true, result: { workResultGuidance: null },
    });
    expect(await runAction('update_user_state', { work_result_guidance: 'Trusted owner choice.' }, { remote: false })).toMatchObject({ ok: true });
  });

  it('limits an agent caller to its own local guidance and keeps shared preference writes owner scoped', async () => {
    const q = await import('@/lib/db/queries');
    const { runAction } = await import('./dispatch');
    const own = q.createWorkspace({ name: 'Own', cwd: root, isGit: false, instructions: 'General agent instruction.' });
    const other = q.createWorkspace({ name: 'Other', cwd: root, isGit: false });
    const session = q.createChatSession({ type: 'execution', harness: 'claude', workspaceId: own.id });
    expect(await runAction('update_workspace', { id: own.id, work_result_guidance: '  Show the preview. ' }, caller(session.id))).toMatchObject({
      ok: true, result: { workResultGuidance: 'Show the preview.', instructions: 'General agent instruction.' },
    });
    expect((await runAction('update_workspace', { id: other.id, work_result_guidance: 'Forbidden' }, caller(session.id))).error?.code).toBe('unsupported');
    expect((await runAction('update_user_state', { work_result_guidance: 'Forbidden' }, caller(session.id))).error?.code).toBe('unsupported');
    expect((await runAction('update_user_state', { work_result_guidance: 'Forbidden' }, { remote: true })).error?.code).toBe('unsupported');
    expect(q.getWorkspace(other.id)?.workResultGuidance).toBeNull();
    expect(q.getUserState()?.workResultGuidance).toBeNull();
    expect(await runAction('update_workspace', { id: own.id, work_result_guidance: '' }, caller(session.id))).toMatchObject({
      ok: true, result: { workResultGuidance: null },
    });
  });

  it('rejects invalid or unavailable callers and invalid guidance before partial updates', async () => {
    const q = await import('@/lib/db/queries');
    const { runAction } = await import('./dispatch');
    const main = q.createChatSession({ type: 'orchestration', harness: 'claude' });
    q.updateUserState({ description: 'Original.', workResultGuidance: 'Original guidance.' });
    expect((await runAction('update_user_state', {
      description: 'Must not commit.', work_result_guidance: 'x'.repeat(WORK_RESULT_GUIDANCE_MAX + 1),
    }, caller(main.id))).error?.code).toBe('invalid_params');
    expect(q.getUserState()).toMatchObject({ description: 'Original.', workResultGuidance: 'Original guidance.' });
    q.updateChatSession(main.id, { status: 'archived' });
    expect((await runAction('update_user_state', { work_result_guidance: null }, caller(main.id))).error?.code).toBe('unsupported');
    expect((await runAction('update_user_state', { work_result_guidance: null }, caller('missing'))).error?.code).toBe('unsupported');
    const reviewer = q.createChatSession({ type: 'execution', harness: 'claude', surfaceKind: 'result_review', surfaceRef: 'review-fixture' });
    expect((await runAction('update_user_state', { work_result_guidance: null }, caller(reviewer.id))).error?.code).toBe('unsupported');
  });

  it('uses the owned execution association and rejects contradictory or claimed scope', async () => {
    const q = await import('@/lib/db/queries');
    const { runAction } = await import('./dispatch');
    const own = q.createWorkspace({ name: 'Own', cwd: root, isGit: false });
    const other = q.createWorkspace({ name: 'Other', cwd: root, isGit: false });
    const execution = q.createExecution({ workspaceId: own.id });
    const session = q.createChatSession({ type: 'execution', harness: 'claude', executionId: execution.id });
    expect(await runAction('update_workspace', { id: own.id, work_result_guidance: 'Own execution guidance.' }, caller(session.id))).toMatchObject({ ok: true });
    expect((await runAction('update_workspace', { id: other.id, work_result_guidance: 'Other guidance.' }, caller(session.id))).error?.code).toBe('unsupported');
    q.updateChatSession(session.id, { workspaceId: other.id });
    for (const id of [own.id, other.id]) {
      expect((await runAction('update_workspace', { id, work_result_guidance: 'Contradictory guidance.' }, caller(session.id))).error?.code).toBe('unsupported');
    }
    q.updateChatSession(session.id, { workspaceId: null });
    expect((await runAction('update_workspace', { id: own.id, work_result_guidance: 'Claimed scope.' }, {
      remote: true, actor: { source: 'ai', sessionId: session.id, executionId: 'claimed-other-execution' },
    })).error?.code).toBe('unsupported');
    expect(q.getWorkspace(own.id)?.workResultGuidance).toBe('Own execution guidance.');
    expect(q.getWorkspace(other.id)?.workResultGuidance).toBeNull();
  });
});
