/**
 * Memory stays at the home (docs/homes-build.md, P2.7, spec §7): a session
 * that can't read the home's files reads MEMORY.md through `read_memory`,
 * and sends findings with `submit_memory_finding` to the home's main chat,
 * which keeps the file. Through a real server, so the finding arrives the
 * way any message from another chat does: labeled, and dispatched.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { startHomeServer, type HomeServer } from '@/test/fixtures/home-server';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';

let home: TestHome;
let server: HomeServer;
let fake: FakeHarness;
const savedBase = process.env.RI_PUBLIC_BASE_URL;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-memory-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  identity.ensureHomeIdentity();
  // The home's own key, as the server's self-calls use it.
  const q = await import('@/lib/db/queries');
  const { writeAuthConfig } = await import('@/lib/auth/config-file');
  writeAuthConfig({ localToken: q.createApiKey({ name: 'Home', deviceType: 'computer' }).token.plaintext });
  server = await startHomeServer();
  process.env.RI_PUBLIC_BASE_URL = server.url;
  fake = installFakeHarness('claude');
});

afterEach(async () => {
  if (savedBase === undefined) delete process.env.RI_PUBLIC_BASE_URL;
  else process.env.RI_PUBLIC_BASE_URL = savedBase;
  fake.restore();
  const { _resetExecutorState } = await import('@/lib/executor/adapter');
  _resetExecutorState();
  await server.close();
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  await home.cleanup();
});

async function action(name: string) {
  const { actions } = await import('./registry');
  return actions.find((a) => a.name === name)!;
}

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

describe('memory', () => {
  it('is read from the home', async () => {
    fs.writeFileSync(path.join(home.root, 'MEMORY.md'), '# Memory\n\n- Ships on Fridays.\n');
    const read = await action('read_memory');
    expect(await read.handler({ remote: true, caller: { location: 'elsewhere' } }, {} as never)).toEqual({
      text: '# Memory\n\n- Ships on Fridays.\n',
    });
  });

  it("reaches the home's main chat, labeled with the chat that found it", async () => {
    const q = await import('@/lib/db/queries');
    const ws = q.createWorkspace({ name: 'Demo', cwd: home.root, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
    const execution = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'Fix the readme' });
    const submit = await action('submit_memory_finding');
    const ctx = { remote: true, actor: { source: 'ai' as const, sessionId: execution.session.id }, caller: { location: 'elsewhere' as const } };
    const result = (await submit.handler(ctx, { finding: 'The user wants pnpm, never npm.' } as never)) as { mainChatId: string };

    const { currentMainChat } = await import('@/lib/sessions/main-chat');
    expect(result.mainChatId).toBe(currentMainChat(null)!.id);
    const stored = q.listChatEvents(result.mainChatId).find((e) => e.role === 'user')!;
    expect(stored).toMatchObject({ senderSessionId: execution.session.id });
    expect(stored.content).toContain('Memory finding: The user wants pnpm, never npm.');
    // The main chat's harness hears who it's from, not the user typing.
    await until(() => fake.sessions.some((s) => s.messages.length > 0), "the main chat's turn");
    expect(fake.latest().messages[0]).toMatch(/^\[Message from the "Fix the readme" execution in "Demo", sent on the user's behalf\]/);
  });

  it('is kept by the main chat itself, which edits the file', async () => {
    const { ensureMainChat } = await import('@/lib/sessions/main-chat');
    const main = await ensureMainChat(null);
    const submit = await action('submit_memory_finding');
    const ctx = { remote: true, actor: { source: 'ai' as const, sessionId: main.id } };
    await expect(submit.handler(ctx, { finding: 'anything' } as never)).rejects.toMatchObject({ code: 'invalid_params' });
  });
});
