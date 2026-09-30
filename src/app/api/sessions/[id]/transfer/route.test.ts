/**
 * Moving work names the device (docs/homes-model.md): any of the person's
 * devices, from any screen. It's refused only for a real reason, said in
 * words: the agent isn't there yet, or that device isn't running Ri.
 */

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { setUpAgentOn } from '@/test/fixtures/setups';

let home: TestHome;
let sessionId: string;
let agentId: string;
let laptopId: string;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-transfer-route-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  identity.ensureHomeIdentity();
  const q = await import('@/lib/db/queries');
  agentId = q.createWorkspace({ name: 'Ri', cwd: home.root, isGit: true, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false }).id;
  sessionId = q.createExecutionWithChat({ workspaceId: agentId, harness: 'claude', label: 'Work' }).session.id;
  const grant = q.createDeviceGrant({ kind: 'enroll', deviceId: null, deviceName: 'Laptop', createdByApiKeyId: null });
  laptopId = q.redeemEnrollGrant({ secret: grant.secret, name: 'Laptop' }).device.id;
});

afterEach(async () => {
  (await import('@/lib/workers/hub'))._resetWorkerHub();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
});

async function move(toDeviceId: string) {
  const { POST } = await import('./route');
  const response = await POST(
    new NextRequest(`http://home/api/sessions/${sessionId}/transfer`, { method: 'POST', body: JSON.stringify({ toDeviceId }) }),
    { params: Promise.resolve({ id: sessionId }) },
  );
  return { status: response.status, body: (await response.json()) as { error?: string; message?: string } };
}

it('says the agent is not on that device yet, rather than refusing a device the page is not on', async () => {
  expect(await move(laptopId)).toEqual({ status: 409, body: { error: 'destination_not_ready', message: "Ri isn't on Laptop yet." } });
});

it('says that device is not running Ri right now', async () => {
  const q = await import('@/lib/db/queries');
  await setUpAgentOn(agentId, laptopId, '/Users/me/ri');
  expect(await move(laptopId)).toEqual({
    status: 409,
    body: { error: 'destination_not_ready', message: "Laptop isn't running Ri right now. Start Ri on Laptop, then move it." },
  });
});
