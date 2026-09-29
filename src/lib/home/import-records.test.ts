/**
 * Bringing the laptop's chats into the Mini's home (P5.1): what a person
 * started, with its work, messages, attachments and ledgers, placed on the
 * MacBook where it ran. Agents the Mini has are joined by name, the others
 * come over. Schedules' chats, tasks and notes stay behind. Nothing already
 * there changes, a second run does nothing, and a failure leaves nothing.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

let mini: TestHome;
let laptopRoot: string;
const ids = {
  riOnLaptop: '',
  bounce: '',
  fixLogin: '',
  fixLoginExecution: '',
  riMainOnLaptop: '',
  bounceMain: '',
  appMainOnLaptop: '',
  scheduled: '',
  taskChat: '',
  imported: '',
  riOnMini: '',
  riMainOnMini: '',
  firstEvent: '',
};
const ATTACHMENT = '01a0f000-0000-7000-8000-00000000a77a.png';

beforeEach(async () => {
  // The laptop's home, made the way the app makes it. Its markdown mirror
  // isn't part of this, and would write after the folder is gone.
  process.env.RI_MIRROR_DISABLED = '1';
  const laptop = await createTestHome({ prefix: 'ri-import-laptop-' });
  {
    const q = await import('@/lib/db/queries');
    const work = q.createArea({ name: 'Work' });
    const ws = (name: string, cwd: string) =>
      q.createWorkspace({ name, cwd, isGit: true, areaId: work.id, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false }).id;
    ids.riOnLaptop = ws('ai-task-manager', '/Users/trey/dynamism/ai-task-manager');
    ids.bounce = ws('bounce', '/Users/trey/studio/bounce');
    const made = q.createExecutionWithChat({ workspaceId: ids.riOnLaptop, harness: 'claude', label: 'Fix login', worktreePath: '/Users/trey/.work/worktrees/ai-task-manager/fix-login' });
    ids.fixLogin = made.session.id;
    ids.fixLoginExecution = made.execution.id;
    q.updateChatSession(ids.fixLogin, { externalSessionId: 'native-fix-login', lastOutcomeEventAt: '2026-09-20T10:00:00.000Z', lastViewedAt: '2026-09-01T00:00:00.000Z' });
    ids.firstEvent = q.insertChatEvent({ sessionId: ids.fixLogin, role: 'user', source: 'user', content: 'The login button does nothing' })!.id;
    q.insertChatEvent({
      sessionId: ids.fixLogin,
      role: 'assistant',
      source: 'agent',
      content: 'Fixed the handler, see the screenshot',
      attachments: [{ fileName: ATTACHMENT, originalName: 'shot.png', mimeType: 'image/png', size: 4, uploadedAt: '2026-09-20T10:00:00.000Z' }],
    });
    q.createPreviewTarget({ executionId: ids.fixLoginExecution, service: 'web', previewName: 'web', port: 3000 });
    const main = (workspaceId: string | null, activity: string) =>
      q.createChatSession({ type: 'orchestration', harness: 'claude', workspaceId, lastActivityAt: activity, startedAt: activity }).id;
    ids.riMainOnLaptop = main(ids.riOnLaptop, '2026-09-25T00:00:00.000Z');
    ids.bounceMain = main(ids.bounce, '2026-09-24T00:00:00.000Z');
    ids.appMainOnLaptop = main(null, '2026-09-26T00:00:00.000Z');
    const task = q.createTask({ title: 'Only on the laptop' });
    ids.taskChat = q.createChatSession({ type: 'content', harness: 'claude', surfaceKind: 'task', surfaceRef: task.id }).id;
    ids.imported = q.createChatSession({ type: 'execution', harness: 'claude', surfaceKind: 'imported_agent', surfaceRef: 'claude', workspaceId: ids.bounce, label: 'From the terminal' }).id;
    (await import('@/lib/db')).resetDb();

    // What only raw rows can say: a chat a schedule started, and a terminal import's ledger.
    const raw = new Database(laptop.dbPath);
    raw.pragma('foreign_keys = OFF');
    ids.scheduled = '01a0f000-0000-7000-8000-00000000005c';
    raw.prepare(
      "INSERT INTO chat_sessions (id, created_at, updated_at, user_id, harness, type, status, created_by_run_id, permission_mode) VALUES (?, datetime('now'), datetime('now'), 'local', 'claude', 'orchestration', 'active', 'a-run', 'default')",
    ).run(ids.scheduled);
    raw.prepare(
      `INSERT INTO external_session_imports (id, created_at, updated_at, chat_session_id, provider_type, external_session_id, source_kind, source_path, sync_offset, status, source_content_sha256)
       VALUES ('01a0f000-0000-7000-8000-0000000001ed', datetime('now'), datetime('now'), ?, 'claude', 'terminal-1', 'file', '/Users/trey/.claude/projects/x/terminal-1.jsonl', 120, 'current', 'abc')`,
    ).run(ids.imported);
    raw.close();
  }
  laptopRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-import-laptop-copy-'));
  fs.cpSync(laptop.root, laptopRoot, { recursive: true });
  fs.mkdirSync(path.join(laptopRoot, 'attachments'), { recursive: true });
  fs.writeFileSync(path.join(laptopRoot, 'attachments', ATTACHMENT), 'png!');
  await laptop.cleanup();
  delete process.env.RI_MIRROR_DISABLED;

  // The Mini: its own Ri agent and main chats, and its identity.
  mini = await createTestHome({ prefix: 'ri-import-mini-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  identity.ensureHomeIdentity();
  const q = await import('@/lib/db/queries');
  q.createArea({ name: 'work' });
  ids.riOnMini = q.createWorkspace({ name: 'AI Task Manager', cwd: mini.root, isGit: true, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false }).id;
  q.updateWorkspace(ids.riOnMini, { name: 'ai-task-manager' });
  ids.riMainOnMini = q.createChatSession({ type: 'orchestration', harness: 'claude', workspaceId: ids.riOnMini, lastActivityAt: '2026-09-01T00:00:00.000Z' }).id;
  q.createChatSession({ type: 'orchestration', harness: 'claude', workspaceId: null, lastActivityAt: '2026-09-01T00:00:00.000Z' });
});

afterEach(async () => {
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  fs.rmSync(laptopRoot, { recursive: true, force: true });
  await mini.cleanup();
});

const options = () => ({ sourceRoot: laptopRoot, computerName: 'MacBook' });

describe('the plan', () => {
  it('names what comes over, what joins what, and what stays behind, without writing anything', async () => {
    const { planHomeImport } = await import('./import-records');
    const before = fs.readFileSync(path.join(laptopRoot, 'data.db'));
    const plan = planHomeImport(options());
    expect(plan.problems).toEqual([]);
    expect(plan.computer).toEqual({ name: 'MacBook', id: null, created: true });
    expect(plan.agents.map((a) => [a.name, a.action, a.destId])).toEqual(
      expect.arrayContaining([
        ['ai-task-manager', 'matched', ids.riOnMini],
        ['bounce', 'created', ids.bounce],
      ]),
    );
    // Fix login, the three main chats, and the terminal import. Not the schedule's, nor the empty one on a task the Mini lacks.
    expect(plan.chats).toMatchObject({ import: 5, scheduled: 1, emptyDetached: 1, mainChatsArchived: 2 });
    expect(plan.executions.import).toBe(1);
    expect(plan.events).toBe(2);
    expect(plan.attachments).toMatchObject({ copy: 1, missing: [] });
    expect(plan.ledgers).toBe(1);
    expect(plan.previews).toBe(1);
    const q = await import('@/lib/db/queries');
    expect(q.getChatSession(ids.fixLogin)).toBeUndefined();
    expect(fs.readFileSync(path.join(laptopRoot, 'data.db')).equals(before)).toBe(true);
  });
});

describe('importing', () => {
  it('brings the chats and their work, placed on the MacBook where they ran', async () => {
    const { applyHomeImport } = await import('./import-records');
    const result = applyHomeImport(options());
    const q = await import('@/lib/db/queries');
    const macbook = q.listComputers().find((c) => c.name === 'MacBook')!;
    expect(result.computer).toEqual({ name: 'MacBook', id: macbook.id, created: true });

    // The same chat, in the Mini's own agent of that name, read.
    const chat = q.getChatSession(ids.fixLogin)!;
    expect(chat).toMatchObject({ workspaceId: ids.riOnMini, executionId: ids.fixLoginExecution, externalSessionId: 'native-fix-login' });
    // Read up to its latest: it doesn't land in Unread.
    expect(chat.lastViewedAt! >= chat.lastOutcomeEventAt!).toBe(true);
    expect(chat.lastViewedAt! >= chat.lastActivityAt!).toBe(true);
    // Its work lives on the MacBook: no folder of the home's own, the MacBook's in its placement.
    expect(q.getExecution(ids.fixLoginExecution)).toMatchObject({ workspaceId: ids.riOnMini, worktreePath: null });
    expect(q.getOpenPlacement(ids.fixLoginExecution)).toMatchObject({
      computerId: macbook.id,
      generation: 1,
      worktreePath: '/Users/trey/.work/worktrees/ai-task-manager/fix-login',
      startReason: 'adopted',
    });
    expect(q.chatPlacement(ids.fixLogin)).toMatchObject({ computerId: macbook.id, isHome: false });
    expect(q.listNativeSessions(ids.fixLogin)).toEqual([expect.objectContaining({ computerId: macbook.id, nativeSessionId: 'native-fix-login' })]);

    // Its messages in order, searchable, and its attachment beside the Mini's.
    const events = q.listChatEvents(ids.fixLogin);
    expect(events.map((e) => e.content)).toEqual(['The login button does nothing', 'Fixed the handler, see the screenshot']);
    expect(events[0]!.id).toBe(ids.firstEvent);
    const { getAttachmentsDir } = await import('@/lib/config/paths');
    expect(fs.readFileSync(path.join(getAttachmentsDir(), ATTACHMENT), 'utf8')).toBe('png!');
    const { getRawDb } = await import('@/lib/db');
    expect(getRawDb().prepare("SELECT session_id FROM chat_events_fts WHERE chat_events_fts MATCH 'screenshot'").all()).toEqual([{ session_id: ids.fixLogin }]);
    expect(q.listPreviewTargetsForExecution(ids.fixLoginExecution)).toHaveLength(1);

    // An agent the Mini lacks comes over, living on the MacBook only.
    expect(q.getWorkspace(ids.bounce)).toMatchObject({ name: 'bounce', cwd: '/Users/trey/studio/bounce', defaultComputerId: macbook.id });
    expect(q.listAgentSetups({ workspaceId: ids.bounce }).map((s) => [s.computerId, s.sourcePath])).toEqual([[macbook.id, '/Users/trey/studio/bounce']]);
    const { runOnFor } = await import('@/lib/setups/run-on');
    expect(runOnFor(ids.bounce)!.livesOn).toMatchObject({ computerId: macbook.id, isHome: false, folder: '/Users/trey/studio/bounce' });
    // Its area is the Mini's area of that name.
    const miniWork = q.listAreas().find((a) => a.name === 'work')!;
    expect(q.getWorkspace(ids.bounce)!.areaId).toBe(miniWork.id);
    // And the Mini's own agent gains its folder on the MacBook, keeping its folder at home.
    expect(q.getAgentSetup(ids.riOnMini, macbook.id)).toMatchObject({ sourcePath: '/Users/trey/dynamism/ai-task-manager' });
    expect(q.getWorkspace(ids.riOnMini)!.cwd).toBe(mini.root);

    // Main chats: the Mini's stay current. Bounce's, which has none here, stays active.
    expect(q.getChatSession(ids.riMainOnLaptop)).toMatchObject({ status: 'archived', computerId: macbook.id });
    expect(q.getChatSession(ids.appMainOnLaptop)).toMatchObject({ status: 'archived' });
    expect(q.getChatSession(ids.bounceMain)).toMatchObject({ status: 'active', workspaceId: ids.bounce });
    expect(q.listMainChats(ids.riOnMini, { status: 'active' }).map((c) => c.id)).toEqual([ids.riMainOnMini]);

    // A terminal import is read from the MacBook from now on, never from a path on it.
    expect(q.getExternalSessionImportForChat(ids.imported)).toMatchObject({ computerId: macbook.id, sourcePath: null, syncOffset: 120, sourceContentSha256: 'abc' });

    // What stayed behind.
    expect(q.getChatSession(ids.scheduled)).toBeUndefined();
    expect(q.getChatSession(ids.taskChat)).toBeUndefined();

    // What came from where.
    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
    expect(manifest.chats).toContain(ids.fixLogin);
    expect(manifest.executions).toEqual([ids.fixLoginExecution]);
    expect(path.dirname(result.manifestPath)).toBe(path.join(mini.root, '.archive', 'imports'));
  });

  it('does nothing the second time, and changes nothing that was already there', async () => {
    const { applyHomeImport, planHomeImport } = await import('./import-records');
    applyHomeImport(options());
    const q = await import('@/lib/db/queries');
    q.updateChatSession(ids.fixLogin, { label: 'Renamed on the Mini' });
    const again = planHomeImport(options());
    expect(again.chats).toMatchObject({ import: 0, alreadyHere: 5 });
    expect(again.executions).toMatchObject({ import: 0, alreadyHere: 1 });
    expect(again.computer).toMatchObject({ name: 'MacBook', created: false });
    applyHomeImport(options());
    expect(q.getChatSession(ids.fixLogin)!.label).toBe('Renamed on the Mini');
    expect(q.listChatEvents(ids.fixLogin)).toHaveLength(2);
    expect(q.listComputers().filter((c) => c.name === 'MacBook')).toHaveLength(1);
  });

  it('leaves nothing behind when the rows fail, attachments included', async () => {
    const { getRawDb } = await import('@/lib/db');
    getRawDb().exec("CREATE TEMP TRIGGER refuse_events BEFORE INSERT ON chat_events BEGIN SELECT RAISE(ABORT, 'refused'); END");
    const { applyHomeImport } = await import('./import-records');
    expect(() => applyHomeImport(options())).toThrow(/refused/);
    const q = await import('@/lib/db/queries');
    expect(q.getChatSession(ids.fixLogin)).toBeUndefined();
    expect(q.getWorkspace(ids.bounce)).toBeFalsy();
    const { getAttachmentsDir } = await import('@/lib/config/paths');
    expect(fs.existsSync(path.join(getAttachmentsDir(), ATTACHMENT))).toBe(false);
    expect(fs.existsSync(path.join(mini.root, '.archive', 'imports'))).toBe(false);
  });

  it("refuses to import as the home's own computer, and a home into itself", async () => {
    const { applyHomeImport, planHomeImport, HomeImportError } = await import('./import-records');
    const q = await import('@/lib/db/queries');
    const host = q.getComputer(q.getHome()!.hostComputerId)!;
    expect(planHomeImport({ sourceRoot: laptopRoot, computerName: host.name }).problems).toEqual([
      `${host.name} is this home's own computer. Name the computer the other home ran on.`,
    ]);
    expect(() => applyHomeImport({ sourceRoot: laptopRoot, computerName: host.name })).toThrow(HomeImportError);
    expect(() => planHomeImport({ sourceRoot: mini.root, computerName: 'MacBook' })).toThrow('A home can not import itself.');
  });

  it("asks, rather than join active work to an agent that's archived here, and can bring it over as its own", async () => {
    const q = await import('@/lib/db/queries');
    q.createWorkspace({ name: 'bounce', cwd: mini.root, isGit: true, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
    const archived = q.listWorkspaces({ status: 'active' }).find((w) => w.name === 'bounce')!;
    q.archiveWorkspace(archived.id);
    const { planHomeImport, applyHomeImport } = await import('./import-records');
    expect(planHomeImport(options()).problems).toEqual([
      `bounce (${ids.bounce}) is active on the other home, and the only agent named that here is archived (${archived.id}). ` +
        `Choose with --map ${ids.bounce}=<agent id>, or --map ${ids.bounce}=new to bring it over as its own agent.`,
    ]);
    applyHomeImport({ ...options(), agentMap: { [ids.bounce]: 'new' } });
    // Its own agent, with the next free slug, since the archived one has its own.
    expect(q.getWorkspace(ids.bounce)).toMatchObject({ name: 'bounce', status: 'active', slug: 'bounce-2' });
    expect(q.getChatSession(ids.bounceMain)).toMatchObject({ workspaceId: ids.bounce });
  });

  it("stops at a chat that continues a conversation a chat here already has", async () => {
    const q = await import('@/lib/db/queries');
    q.createChatSession({ type: 'orchestration', harness: 'claude', externalProviderType: 'claude', externalSessionId: 'native-fix-login' });
    const src = new Database(path.join(laptopRoot, 'data.db'));
    src.prepare("UPDATE chat_sessions SET external_provider_type = 'claude' WHERE id = ?").run(ids.fixLogin);
    src.close();
    const { planHomeImport } = await import('./import-records');
    expect(planHomeImport(options()).problems).toEqual([
      `The chat ${ids.fixLogin} continues a conversation (native-fix-login) that a chat here already has.`,
    ]);
  });

  it('follows an agent map over the match by name', async () => {
    const q = await import('@/lib/db/queries');
    const other = q.createWorkspace({ name: 'Bounce, renamed', cwd: mini.root, isGit: true, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false }).id;
    const { applyHomeImport } = await import('./import-records');
    applyHomeImport({ ...options(), agentMap: { [ids.bounce]: other } });
    expect(q.getChatSession(ids.bounceMain)).toMatchObject({ workspaceId: other });
    expect(q.getWorkspace(ids.bounce)).toBeFalsy();
  });
});
