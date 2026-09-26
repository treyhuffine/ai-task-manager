/**
 * Previews of work on another computer (P3.5, spec §6): never started here,
 * where the only folder is the agent's checkout at home, never given a local
 * address to another device, and saying where it runs. A URL pasted for it,
 * the person's own tunnel, is the one address it gets.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

let home: TestHome;
let executionId: string;
let workspaceId: string;
const MARK = 'started-at-home';

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-preview-elsewhere-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  identity.ensureHomeIdentity();
  const q = await import('@/lib/db/queries');
  const grant = q.createComputerGrant({ kind: 'enroll', computerId: null, computerName: 'MacBook', createdByApiKeyId: null });
  const laptopId = q.redeemEnrollGrant({ secret: grant.secret, name: 'MacBook' }).computer.id;
  // The agent's checkout at home, which a home preview would have started in.
  const checkout = path.join(home.root, 'demo');
  fs.mkdirSync(checkout, { recursive: true });
  workspaceId = q.createWorkspace({
    name: 'Demo', cwd: checkout, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false,
    startCommand: `touch ${MARK} && sleep 30`,
  }).id;
  executionId = q.createExecutionWithChat({ workspaceId, harness: 'claude', label: 'On the laptop' }).execution.id;
  q.createPlacement({ executionId, computerId: laptopId, startReason: 'created', worktreePath: '/Users/trey/code/demo/.work/demo-1' });
});

afterEach(async () => {
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
});

describe('a preview of work on another computer', () => {
  it('starts nothing here, locally or for a remote viewer, and says where it runs', async () => {
    const service = await import('./service');
    const q = await import('@/lib/db/queries');
    for (const remote of [false, true]) {
      const state = await service.resolvePreview(executionId, { remote });
      expect(state).toMatchObject({
        serverStatus: 'idle',
        localUrl: null,
        remoteUrl: null,
        elsewhere: { computerName: 'MacBook', folder: '/Users/trey/code/demo/.work/demo-1' },
      });
    }
    expect(q.listPreviewTargetsForExecution(executionId)).toEqual([]);
    const { getSupervisor } = await import('./supervisor');
    expect(getSupervisor().liveKeys()).toEqual([]);
    await new Promise((r) => setTimeout(r, 200));
    expect(fs.existsSync(path.join(home.root, 'demo', MARK))).toBe(false);
    expect(service.getPreviewState(executionId)).toMatchObject({ serverStatus: 'idle', elsewhere: { computerName: 'MacBook' } });
  });

  it('gives a viewer elsewhere the address pasted for it, as given', async () => {
    const service = await import('./service');
    service.setPreviewUrls(executionId, [{ url: 'https://demo.my-tunnel.dev', service: null }] as never);
    expect(await service.resolvePreview(executionId, { remote: true })).toMatchObject({ remoteUrl: 'https://demo.my-tunnel.dev', localUrl: null });
    expect(await service.resolvePreview(executionId, { remote: false })).toMatchObject({ remoteUrl: null, localUrl: null });
  });

  it("isn't brought up by restoring the agent's pinned previews", async () => {
    const q = await import('@/lib/db/queries');
    q.createPreviewTarget({ executionId, service: null, port: 45123, previewName: 'demo-1', pinned: true } as never);
    const { restoreWorkspacePreviews } = await import('./service');
    expect(await restoreWorkspacePreviews(workspaceId)).toEqual([
      { executionId, service: null, ok: false, error: 'It runs on MacBook.' },
    ]);
    const { getSupervisor } = await import('./supervisor');
    expect(getSupervisor().liveKeys()).toEqual([]);
  });
});
