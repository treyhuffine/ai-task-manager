/**
 * Opening an execution's or agent's folder on the viewer's own computer
 * (P3.5, spec §3.3): only for a browser whose viewing key is linked to the
 * computer the files are on, through that computer's worker, with known
 * apps only. Everyone else is told where the files are.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { API_KEY_ID_HEADER, API_KEY_TYPE_HEADER } from '@/lib/auth/request-key';

const requestWorker = vi.fn();
vi.mock('@/lib/workers/hub', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/workers/hub')>()),
  requestWorker: (...args: unknown[]) => requestWorker(...args),
}));

let home: TestHome;
let laptopId: string;
let desktopId: string;
let chatId: string;
let homeChatId: string;
let agentId: string;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-open-viewer-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  identity.ensureHomeIdentity();
  const q = await import('@/lib/db/queries');
  const enroll = (name: string) => {
    const grant = q.createComputerGrant({ kind: 'enroll', computerId: null, computerName: name, createdByApiKeyId: null });
    return q.redeemEnrollGrant({ secret: grant.secret, name }).computer.id;
  };
  laptopId = enroll('MacBook');
  desktopId = enroll('Studio');
  agentId = q.createWorkspace({ name: 'Ri', cwd: home.root, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false }).id;
  const there = q.createExecutionWithChat({ workspaceId: agentId, harness: 'claude', label: 'On the laptop' });
  q.createPlacement({ executionId: there.execution.id, computerId: laptopId, startReason: 'created', worktreePath: '/Users/trey/code/ri/.work/ri-1' });
  chatId = there.session.id;
  homeChatId = q.createExecutionWithChat({ workspaceId: agentId, harness: 'claude', label: 'At home' }).session.id;
  q.recordAgentSetupReports(laptopId, [{ agentId, sourcePath: '/Users/trey/code/ri', configRevision: null, status: 'ready', problem: null, references: [] }], { complete: true });
  requestWorker.mockReset();
  requestWorker.mockResolvedValue({ status: 200, body: { ok: true } });
});

afterEach(async () => {
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
});

/** A browser's viewing key, linked to a computer the way "This Mac" links it. */
async function browserOn(computerId: string | null): Promise<Record<string, string>> {
  const q = await import('@/lib/db/queries');
  const key = q.createApiKey({ name: 'Browser', deviceType: 'other' });
  if (computerId) {
    const grant = q.createComputerGrant({ kind: 'associate', computerId, createdByApiKeyId: null });
    q.redeemAssociateGrant({ secret: grant.secret, apiKeyId: key.key.id });
  }
  return { [API_KEY_ID_HEADER]: key.key.id, [API_KEY_TYPE_HEADER]: 'other' };
}

async function open(kind: 'sessions' | 'workspaces', id: string, headers: Record<string, string>, body: unknown) {
  const { POST } = (await import(`@/app/api/${kind}/[id]/open/route`)) as { POST: (r: Request, c: unknown) => Promise<Response> };
  const res = await POST(
    new Request('http://x', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, body: await res.json() };
}

describe('opening files on the viewer’s own computer', () => {
  it('opens an execution’s worktree through its computer’s worker, for a browser on that computer', async () => {
    const onLaptop = await browserOn(laptopId);
    expect(await open('sessions', chatId, onLaptop, { op: 'open', path: 'src/app.ts', target: 'vscode', line: 4 })).toEqual({ status: 200, body: { ok: true } });
    const q = await import('@/lib/db/queries');
    const executionId = q.getChatSessionWithExecution(chatId)!.executionId;
    expect(requestWorker).toHaveBeenCalledWith(laptopId, 'open_here', {
      op: 'open', folder: { kind: 'execution', executionId, generation: 1 }, path: 'src/app.ts', target: 'vscode', line: 4,
    });
    await open('workspaces', agentId, onLaptop, { op: 'apps' });
    expect(requestWorker).toHaveBeenLastCalledWith(laptopId, 'open_here', { op: 'apps' });
  });

  it('tells any other browser where the files are, and runs nothing', async () => {
    const refused = { status: 409, body: { error: 'not_here', message: 'The files are on MacBook. Open them from a browser on MacBook.' } };
    expect(await open('sessions', chatId, await browserOn(desktopId), { op: 'open', path: null, target: 'finder' })).toEqual(refused);
    expect(await open('sessions', chatId, await browserOn(null), { op: 'open', path: null, target: 'finder' })).toEqual(refused);
    expect(await open('sessions', chatId, {}, { op: 'open', path: null, target: 'finder' })).toEqual(refused);
    expect(await open('sessions', homeChatId, await browserOn(laptopId), { op: 'open', path: null, target: 'finder' })).toMatchObject({ status: 409, body: { error: 'at_home' } });
    expect(requestWorker).not.toHaveBeenCalled();
  });

  it('opens only known apps, never a command', async () => {
    const onLaptop = await browserOn(laptopId);
    expect(await open('sessions', chatId, onLaptop, { op: 'open', path: null, target: 'custom', command: 'rm -rf ~' })).toMatchObject({ status: 400 });
    expect(requestWorker).not.toHaveBeenCalled();
  });
});
