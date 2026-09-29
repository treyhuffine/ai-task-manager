/**
 * Moving a home from a laptop to an always-on device (docs/homes-spec.md
 * §10.3, P5.3): exported stopped, imported elsewhere with the same id, the
 * old host retired, and the new one claimed. What ran on the laptop without
 * saying so is pinned to it, since its worktrees and native transcripts are
 * there, and the laptop stays a device of the home, ready to run its work.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

let laptop: TestHome;
const ids = {
  home: '',
  laptopHost: '',
  mini: '',
  miniKey: '',
  ri: '',
  docs: '',
  laptopWork: '',
  miniWork: '',
  appMain: '',
  riMain: '',
  docsMain: '',
  terminal: '',
};

async function seedLaptopHome(): Promise<void> {
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  const made = identity.ensureHomeIdentity();
  ids.home = made.home.id;
  ids.laptopHost = made.device.id;
  const q = await import('@/lib/db/queries');
  const ws = (name: string, cwd: string) =>
    q.createWorkspace({ name, cwd, isGit: true, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false }).id;
  ids.ri = ws('Ri', '/Users/trey/ri-app');
  ids.docs = ws('Docs', '/Users/trey/docs');
  q.setAgentFolder(ids.ri, ids.laptopHost, '/Users/trey/ri-app');
  q.setAgentFolder(ids.docs, ids.laptopHost, '/Users/trey/docs');
  // The Mini already ran the home's work: enrolled, with Docs set up there.
  const grant = q.createDeviceGrant({ kind: 'enroll', deviceId: null, deviceName: 'Mac Mini', createdByApiKeyId: null });
  const enrolled = q.redeemEnrollGrant({ secret: grant.secret, name: 'Mac Mini' });
  ids.mini = enrolled.device.id;
  ids.miniKey = enrolled.key.id;
  q.setAgentFolder(ids.docs, ids.mini, '/Users/mini/docs');
  // Work the laptop ran as the home (no placement), and work continued onto the Mini.
  const here = q.createExecutionWithChat({ workspaceId: ids.ri, harness: 'claude', label: 'On the laptop', worktreePath: '/Users/trey/ri/.work/worktrees/ri/ri-1' });
  ids.laptopWork = here.execution.id;
  const there = q.createExecutionWithChat({ workspaceId: ids.docs, harness: 'claude', label: 'On the Mini', worktreePath: null });
  ids.miniWork = there.execution.id;
  q.createPlacement({ executionId: ids.miniWork, deviceId: ids.mini, startReason: 'created', worktreePath: '/Users/mini/.work/worktrees/docs/docs-1' });
  // Main chats with native sessions on the laptop, and a terminal import from its disk.
  const main = (workspaceId: string | null, native: string) => {
    const c = q.createChatSession({ type: 'orchestration', harness: 'claude', workspaceId, externalSessionId: native });
    q.recordNativeSession({ chatSessionId: c.id, harness: 'claude', nativeSessionId: native, deviceId: null, placementId: null });
    return c.id;
  };
  ids.appMain = main(null, 'native-app');
  ids.riMain = main(ids.ri, 'native-ri');
  ids.docsMain = main(ids.docs, 'native-docs');
  const imported = q.createChatSession({ type: 'execution', harness: 'claude', surfaceKind: 'imported_agent', surfaceRef: 'claude', workspaceId: ids.ri });
  ids.terminal = imported.id;
  const { getRawDb } = await import('@/lib/db');
  getRawDb()
    .prepare(
      `INSERT INTO external_session_imports (id, created_at, updated_at, chat_session_id, provider_type, external_session_id, source_kind, source_path, sync_offset, status)
       VALUES ('01a0f111-0000-7000-8000-000000000001', datetime('now'), datetime('now'), ?, 'claude', 'terminal-1', 'file', '/Users/trey/.claude/projects/x/terminal-1.jsonl', 10, 'current')`,
    )
    .run(ids.terminal);
}

beforeEach(async () => {
  process.env.RI_MIRROR_DISABLED = '1';
  laptop = await createTestHome({ prefix: 'ri-move-laptop-' });
  await seedLaptopHome();
});

afterEach(async () => {
  delete process.env.RI_MIRROR_DISABLED;
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await laptop.cleanup();
});

describe('the home moving to the Mini', () => {
  it('pins what ran on the laptop to it, and makes the Mini the home', async () => {
    const q = await import('@/lib/db/queries');
    const moved = q.moveHomeHost(ids.mini);
    expect(moved).toMatchObject({ from: ids.laptopHost, to: ids.mini, pinnedExecutions: 1 });
    expect(q.getHome()!.hostDeviceId).toBe(ids.mini);

    // The laptop's work stays there, with its worktree. The Mini's work is home work now.
    expect(q.getOpenPlacement(ids.laptopWork)).toMatchObject({ deviceId: ids.laptopHost, worktreePath: '/Users/trey/ri/.work/worktrees/ri/ri-1', generation: 1 });
    expect(q.getExecution(ids.laptopWork)!.worktreePath).toBeNull();
    expect(q.getExecution(ids.miniWork)!.worktreePath).toBe('/Users/mini/.work/worktrees/docs/docs-1');
    const laptopChat = q.listWorkspaceExecutions(ids.ri).find((c) => c.executionId === ids.laptopWork)!;
    expect(q.chatPlacement(laptopChat.id)).toMatchObject({ deviceId: ids.laptopHost, isHome: false });

    // Ri lives only on the laptop: its main chat stays there, with its native session.
    expect(q.getChatSession(ids.riMain)).toMatchObject({ deviceId: ids.laptopHost, externalSessionId: 'native-ri' });
    // Docs is set up on the Mini, and the app's main chat is the home's: fresh sessions here.
    for (const id of [ids.docsMain, ids.appMain]) {
      expect(q.getChatSession(id)).toMatchObject({ deviceId: null, externalSessionId: null });
      expect(q.listNativeSessions(id).every((n) => n.endedAt !== null)).toBe(true);
    }
    // Ri's terminal import is a Ri chat outside an execution too: it stays on the laptop.
    expect(q.getChatSession(ids.terminal)!.deviceId).toBe(ids.laptopHost);
    expect(moved).toMatchObject({ pinnedChats: 2, freshChats: 2 });

    // The terminal import is read from the laptop now, never a path on it.
    expect(q.getExternalSessionImportForChat(ids.terminal)).toMatchObject({ deviceId: ids.laptopHost, sourcePath: null });
    // Each agent's home folder is its folder on the Mini, where it has one.
    expect(q.getWorkspace(ids.docs)!.cwd).toBe('/Users/mini/docs');
    expect(q.getWorkspace(ids.ri)!.cwd).toBe('/Users/trey/ri-app');
    const { runOnFor } = await import('@/lib/setups/run-on');
    expect(runOnFor(ids.ri)!.livesOn).toMatchObject({ deviceId: ids.laptopHost, isHome: false });
    expect(runOnFor(ids.docs)!.livesOn).toMatchObject({ deviceId: ids.mini, isHome: true, folder: '/Users/mini/docs' });

    // The Mini runs its own work now: its worker key is revoked. The laptop stays, ready to enroll.
    const { getRawDb } = await import('@/lib/db');
    expect((getRawDb().prepare('SELECT revoked_at FROM api_keys WHERE id = ?').get(ids.miniKey) as { revoked_at: string | null }).revoked_at).not.toBeNull();
    expect(q.getDevice(ids.laptopHost)!.status).toBe('active');
  });

  it('changes nothing when the host stays the same', async () => {
    const q = await import('@/lib/db/queries');
    expect(q.moveHomeHost(ids.laptopHost)).toMatchObject({ pinnedExecutions: 0, pinnedChats: 0, freshChats: 0 });
    expect(q.getOpenPlacement(ids.laptopWork)).toBeNull();
    expect(q.getChatSession(ids.appMain)!.externalSessionId).toBe('native-app');
  });
});

describe('export, import, retire, claim', () => {
  it('moves the home with its id, and the old folder never runs it again', async () => {
    const { resetDb } = await import('@/lib/db');
    const { exportHome, importHome, MoveError } = await import('./move');
    const out = `${laptop.root}-export`;
    // Not while the home has its database open.
    await expect(exportHome(out)).rejects.toThrow(MoveError);
    resetDb();
    const manifest = await exportHome(out);
    expect(manifest.database.homeId).toBe(ids.home);

    // The laptop retires its home, its worktrees staying.
    fs.mkdirSync(path.join(laptop.root, '.work', 'worktrees', 'ri', 'ri-1'), { recursive: true });
    const { retireHome } = await import('./retire');
    retireHome({ successor: 'My Ri on the Mac Mini' });
    expect(fs.existsSync(path.join(laptop.root, '.work', 'worktrees', 'ri', 'ri-1'))).toBe(true);

    // The Mini imports it into a folder of its own: the same home, waiting to be claimed.
    const miniRoot = `${laptop.root}-mini`;
    const saved = { root: process.env.RI_ROOT, db: process.env.RI_DB_PATH, config: process.env.RI_CONFIG_DIR, work: process.env.RI_WORK_DIR };
    try {
      process.env.RI_ROOT = miniRoot;
      process.env.RI_DB_PATH = path.join(miniRoot, 'data.db');
      process.env.RI_CONFIG_DIR = path.join(miniRoot, '.config');
      process.env.RI_WORK_DIR = path.join(miniRoot, '.work');
      const identity = await import('@/lib/home/identity');
      identity.resetHomeIdentityCache();
      importHome(out);
      expect(() => importHome(out)).toThrow('This folder already has a home. Import into a folder of its own.');
      expect(identity.resolveHomeIdentity()).toMatchObject({ state: 'needs_claim', reason: 'no_machine_identity' });

      // Claimed as the Mini it already knew: the same device, now the host.
      const claimed = identity.claimHome({ as: ids.mini });
      expect(claimed.home.id).toBe(ids.home);
      expect(claimed.device.id).toBe(ids.mini);
      expect(claimed.moved).toMatchObject({ from: ids.laptopHost, to: ids.mini, pinnedExecutions: 1 });
      const q = await import('@/lib/db/queries');
      expect(q.getOpenPlacement(ids.laptopWork)!.deviceId).toBe(ids.laptopHost);
      expect(identity.isHomeActive()).toBe(true);
    } finally {
      resetDb();
      (await import('@/lib/home/identity')).resetHomeIdentityCache();
      process.env.RI_ROOT = saved.root;
      process.env.RI_DB_PATH = saved.db;
      process.env.RI_CONFIG_DIR = saved.config;
      process.env.RI_WORK_DIR = saved.work;
      fs.rmSync(miniRoot, { recursive: true, force: true });
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it('claims a restore on the device that ran it as that device, moving nothing', async () => {
    const { resetDb } = await import('@/lib/db');
    resetDb();
    fs.rmSync(path.join(laptop.configDir, 'machine.json'));
    const identity = await import('@/lib/home/identity');
    identity.resetHomeIdentityCache();
    const claimed = identity.claimHome({ as: ids.laptopHost });
    expect(claimed.device.id).toBe(ids.laptopHost);
    expect(claimed.moved).toBeNull();
    const q = await import('@/lib/db/queries');
    expect(q.getOpenPlacement(ids.laptopWork)).toBeNull();
    expect(q.getChatSession(ids.appMain)!.externalSessionId).toBe('native-app');
  });
});
