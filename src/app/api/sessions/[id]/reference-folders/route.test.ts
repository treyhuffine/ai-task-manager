/**
 * The composer's `@`-picker lists a chat's linked folders where the chat
 * runs: at home, the home's paths, browsable. On another device, that
 * device's paths as the home records them, and not browsable from here,
 * since the files are there.
 */

import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { setUpAgentOn } from '@/test/fixtures/setups';

let home: TestHome;
let hostId: string;
let macbookId: string;
let agentId: string;

beforeEach(async () => {
  process.env.RI_MIRROR_DISABLED = '1';
  home = await createTestHome({ prefix: 'ri-session-refs-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  hostId = identity.ensureHomeIdentity().home.hostDeviceId!;
  const q = await import('@/lib/db/queries');
  macbookId = q.createDevice({ name: 'MacBook', kind: 'computer' }).id;
  agentId = q.createWorkspace({ name: 'Bounce', cwd: home.root, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false }).id;
  q.createReferenceFolder({ workspaceId: agentId, alias: 'beamd-cli' });
});

afterEach(async () => {
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
  delete process.env.RI_MIRROR_DISABLED;
});

async function picker(chatId: string) {
  const { GET } = await import('./route');
  const res = await GET(new NextRequest(`http://home/api/sessions/${chatId}/reference-folders`), { params: Promise.resolve({ id: chatId }) });
  return ((await res.json()) as { referenceFolders: Array<Record<string, unknown>> }).referenceFolders;
}

it("gives a chat on another device that device's path, not browsable from here", async () => {
  await setUpAgentOn(agentId, macbookId, '/Users/trey/studio/bounce', { links: { 'beamd-cli': '/Users/trey/code/beamd' } });
  const q = await import('@/lib/db/queries');
  const chat = q.createChatSession({ type: 'orchestration', workspaceId: agentId, deviceId: macbookId, harness: 'claude', status: 'active' });
  expect(await picker(chat.id)).toEqual([
    expect.objectContaining({ alias: 'beamd-cli', absolutePath: '/Users/trey/code/beamd', exists: true, browsable: false }),
  ]);
});

it("gives a chat at home the home's path, browsable", async () => {
  const beamd = path.join(home.root, 'beamd');
  fs.mkdirSync(beamd);
  await setUpAgentOn(agentId, hostId, home.root, { links: { 'beamd-cli': beamd } });
  const q = await import('@/lib/db/queries');
  const chat = q.createChatSession({ type: 'orchestration', workspaceId: agentId, harness: 'claude', status: 'active' });
  expect(await picker(chat.id)).toEqual([
    expect.objectContaining({ alias: 'beamd-cli', absolutePath: beamd, exists: true, browsable: true }),
  ]);
});
