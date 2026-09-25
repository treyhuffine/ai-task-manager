/**
 * Terminal history from a connected computer (docs/homes-build.md, P2.9),
 * end to end: the worker in a process of its own with its own Claude history,
 * the home in this process behind its real proxy and routes. Listing gives
 * what a person needs to choose and nothing of a transcript. A chosen session
 * imports read-only into the agent set up in that folder there, and stays
 * fresh from that computer while it's connected.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { startHomeServer, type HomeServer } from '@/test/fixtures/home-server';
import { startWorkerProcess, type WorkerProcess } from '@/test/fixtures/worker-process';

const IN_AGENT = '11111111-1111-4111-8111-111111111111';
const ELSEWHERE = '22222222-2222-4222-8222-222222222222';
const RUN_BY_RI = '33333333-3333-4333-8333-333333333333';

let home: TestHome;
let server: HomeServer;
let worker: WorkerProcess | null = null;
let laptopRoot: string;
let claudeHome: string;
let computerId: string;
let homeId: string;
let workerKey: string;
let agentId: string;
let demo: string;
let other: string;

function writeJsonl(file: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

function transcript(id: string, cwd: string, lines: Array<{ role: 'user' | 'assistant'; text: string; at: string }>): unknown[] {
  return lines.map((line, i) =>
    line.role === 'user'
      ? { type: 'user', uuid: `${id}-${i}`, sessionId: id, cwd, gitBranch: 'main', timestamp: line.at, isSidechain: false, message: { role: 'user', content: line.text } }
      : {
          type: 'assistant',
          uuid: `${id}-${i}`,
          sessionId: id,
          cwd,
          timestamp: line.at,
          message: { id: `msg-${id}-${i}`, role: 'assistant', content: [{ type: 'text', text: line.text }] },
        },
  );
}

const fileOf = (id: string, cwd: string) => path.join(claudeHome, 'projects', cwd.replace(/[/.]/g, '-'), `${id}.jsonl`);

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-remote-history-' });
  laptopRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-remote-history-laptop-')));
  claudeHome = path.join(laptopRoot, 'claude');
  demo = path.join(laptopRoot, 'projects', 'demo');
  other = path.join(laptopRoot, 'projects', 'other');
  fs.mkdirSync(demo, { recursive: true });
  fs.mkdirSync(other, { recursive: true });
  writeJsonl(fileOf(IN_AGENT, demo), transcript(IN_AGENT, demo, [
    { role: 'user', text: 'Tidy the readme', at: '2026-09-20T10:00:00.000Z' },
    { role: 'assistant', text: 'The readme is tidy.', at: '2026-09-20T10:00:05.000Z' },
  ]));
  writeJsonl(fileOf(ELSEWHERE, other), transcript(ELSEWHERE, other, [
    { role: 'user', text: 'Private notes from another folder', at: '2026-09-21T10:00:00.000Z' },
    { role: 'assistant', text: 'Something only this computer should hold.', at: '2026-09-21T10:00:05.000Z' },
  ]));
  writeJsonl(fileOf(RUN_BY_RI, demo), transcript(RUN_BY_RI, demo, [
    { role: 'user', text: 'Started from Ri', at: '2026-09-22T10:00:00.000Z' },
    { role: 'assistant', text: 'Working in a worktree.', at: '2026-09-22T10:00:05.000Z' },
  ]));

  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  homeId = identity.ensureHomeIdentity().home.id;
  const q = await import('@/lib/db/queries');
  const laptop = q.createApiKey({ name: 'Laptop CLI', deviceType: 'computer' });
  computerId = q.registerComputerForApiKey({ apiKeyId: laptop.key.id, name: 'Laptop', platform: 'darwin' }).computer.id;
  server = await startHomeServer();
  const grant = await fetch(`${server.url}/api/workers/grants`, {
    method: 'POST',
    headers: { authorization: `Bearer ${laptop.token.plaintext}`, 'content-type': 'application/json' },
    body: '{}',
  }).then((r) => r.json() as Promise<{ code: string }>);
  ({ workerKey } = await fetch(`${server.url}/api/workers/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: grant.code, name: 'laptop', protocol: 1, version: 'test' }),
  }).then((r) => r.json() as Promise<{ workerKey: string }>));

  // The Demo agent, set up in the demo folder on the laptop.
  const ws = q.createWorkspace({ name: 'Demo', cwd: path.join(home.root, 'demo-on-the-mini'), isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
  agentId = ws.id;
  q.recordAgentSetupReports(computerId, [{ agentId, sourcePath: demo, configRevision: null, references: [], status: 'ready', problem: null }], { complete: true });
  // And a session Ri runs there itself.
  const ours = q.createExecutionWithChat({ workspaceId: agentId, harness: 'claude', label: 'Ri run' });
  q.createPlacement({ executionId: ours.execution.id, computerId, startReason: 'created', worktreePath: demo });
  q.updateChatSession(ours.session.id, { externalSessionId: RUN_BY_RI });

  worker = await startWorker();
}, 60_000);

afterEach(async () => {
  await worker?.stop();
  worker = null;
  (await import('@/lib/workers/hub'))._resetWorkerHub();
  await server.close();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
  fs.rmSync(laptopRoot, { recursive: true, force: true });
});

async function startWorker(): Promise<WorkerProcess> {
  const q = await import('@/lib/db/queries');
  const started = await startWorkerProcess({
    homeUrl: server.url,
    homeId,
    workerKey,
    root: laptopRoot,
    env: { CLAUDE_CONFIG_DIR: claudeHome, CODEX_HOME: path.join(laptopRoot, 'codex') },
  });
  const { isComputerConnected } = await import('@/lib/workers/hub');
  await until(() => isComputerConnected(computerId) && (q.getComputer(computerId)?.harnesses?.length ?? 0) > 0, 'the laptop');
  return started;
}

async function until(check: () => boolean, what: string, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timed out waiting for ${what}.\n${worker?.output() ?? ''}`);
}

const keyOf = (id: string) => `claude:${Buffer.from(id, 'utf8').toString('base64url')}`;

describe('terminal history on a connected computer', () => {
  it("is listed by folder, with what Ri already has of it, and without a transcript's content or place", async () => {
    const { requestWorker } = await import('@/lib/workers/hub');
    const raw = JSON.stringify(await requestWorker(computerId, 'list_history', null, 60_000));
    expect(raw).not.toContain('Something only this computer should hold.');
    expect(raw).not.toContain(claudeHome);

    const { discoverRemoteSessions } = await import('@/lib/import/remote');
    const found = await discoverRemoteSessions(computerId);
    expect(found.computer).toEqual({ id: computerId, name: 'Laptop' });
    const byFolder = new Map(found.projects.map((p) => [p.cwd, p]));
    expect(byFolder.get(demo)?.agent).toEqual({ id: agentId, name: 'Demo' });
    expect(byFolder.get(other)?.agent).toBeNull();
    const session = (id: string) => found.projects.flatMap((p) => p.sessions).find((s) => s.externalSessionId === id)!;
    expect(session(IN_AGENT)).toMatchObject({ importable: true, imported: false, importStatus: 'not_imported' });
    expect(session(ELSEWHERE)).toMatchObject({ importable: false, note: 'Set this folder up as an agent on Laptop to import its sessions.' });
    expect(session(RUN_BY_RI)).toMatchObject({ importable: false, imported: true, note: 'Ri runs this session there.' });
  }, 60_000);

  it('imports a chosen session read-only into the agent there, placed on that computer, and only that one', async () => {
    const q = await import('@/lib/db/queries');
    const { importRemoteSessions } = await import('@/lib/import/remote');
    const result = await importRemoteSessions(computerId, [keyOf(IN_AGENT), keyOf(ELSEWHERE), keyOf(RUN_BY_RI)]);
    expect(result).toMatchObject({ importedSessions: 1, skippedSessions: 1 });
    expect(result.failures).toEqual([{ key: keyOf(ELSEWHERE), error: `Set ${other} up as an agent on Laptop to import its sessions.` }]);

    const chatId = result.sessions.find((s) => s.key === keyOf(IN_AGENT))!.chatSessionId;
    const chat = q.getChatSessionWithExecution(chatId)!;
    expect(chat).toMatchObject({ surfaceKind: 'imported_agent', workspaceId: agentId });
    expect(chat.execution?.worktreePath ?? null).toBeNull();
    expect(q.getOpenPlacement(chat.executionId!)).toMatchObject({ computerId, worktreePath: demo, startReason: 'adopted' });
    expect(q.getExternalSessionImportForChat(chatId)).toMatchObject({ computerId, sourcePath: null, status: 'current' });
    expect(q.listChatEvents(chatId).map((e) => e.content)).toEqual(['Tidy the readme', 'The readme is tidy.']);
    // Nothing of the session that wasn't chosen reached the home.
    expect(JSON.stringify(q.listChatEvents(chatId))).not.toContain('Private notes');

    const { takeOverImportedSession } = await import('@/lib/import/external-agents');
    expect(() => takeOverImportedSession(chatId)).toThrow('This session lives on Laptop. It can be read here, and continued in a terminal there.');
  }, 60_000);

  it('stays fresh from that computer, starts over when its transcript was rewritten, and keeps what it has while away', async () => {
    const q = await import('@/lib/db/queries');
    const { importRemoteSessions, syncRemoteImport } = await import('@/lib/import/remote');
    const chatId = (await importRemoteSessions(computerId, [keyOf(IN_AGENT)])).sessions[0]!.chatSessionId;
    const contents = () => q.listChatEvents(chatId).map((e) => e.content);

    // More work in the laptop's terminal.
    fs.appendFileSync(fileOf(IN_AGENT, demo), JSON.stringify(transcript(IN_AGENT, demo, [
      { role: 'user', text: 'And the changelog', at: '2026-09-20T11:00:00.000Z' },
    ])[0]).replace(`"${IN_AGENT}-0"`, `"${IN_AGENT}-2"`) + '\n');
    const { discoverRemoteSessions } = await import('@/lib/import/remote');
    const statusNow = async () =>
      (await discoverRemoteSessions(computerId)).projects.flatMap((p) => p.sessions).find((s) => s.externalSessionId === IN_AGENT)!.importStatus;
    expect(await statusNow()).toBe('changed');
    expect(await syncRemoteImport(chatId)).toEqual({ replayed: 1 });
    expect(contents()).toEqual(['Tidy the readme', 'The readme is tidy.', 'And the changelog']);
    expect(await syncRemoteImport(chatId)).toEqual({ replayed: 0, skipped: 'current' });
    expect(await statusNow()).toBe('current');

    // The transcript was rewritten there: the import starts over.
    writeJsonl(fileOf(IN_AGENT, demo), transcript(IN_AGENT, demo, [
      { role: 'user', text: 'Tidy the readme, again', at: '2026-09-20T12:00:00.000Z' },
    ]));
    await syncRemoteImport(chatId);
    expect(contents()).toEqual(['Tidy the readme, again']);

    // Away: nothing changes, and it says so.
    await worker!.stop();
    worker = null;
    const { isComputerConnected } = await import('@/lib/workers/hub');
    await until(() => !isComputerConnected(computerId), 'the laptop to go');
    expect(await syncRemoteImport(chatId)).toEqual({ replayed: 0, skipped: 'offline' });
    expect(contents()).toEqual(['Tidy the readme, again']);
  }, 90_000);
});

describe('an imported session\'s identity', () => {
  it('is qualified by computer, so the same native id on two computers is two sessions', async () => {
    const q = await import('@/lib/db/queries');
    const { getDb } = await import('@/lib/db');
    const { externalSessionImports } = await import('@/lib/db/schema');
    const insert = (chatSessionId: string, computer: string | null) =>
      getDb().insert(externalSessionImports).values({
        id: `${chatSessionId}-ledger`,
        chatSessionId,
        providerType: 'claude',
        externalSessionId: 'same-native-id',
        computerId: computer,
        sourceKind: 'file',
        syncOffset: 0,
        status: 'current',
      }).run();
    const chat = () => q.createChatSession({ type: 'execution', harness: 'claude', status: 'active' }).id;
    insert(chat(), null);
    insert(chat(), computerId);
    expect(() => insert(chat(), computerId)).toThrow(/UNIQUE/);
    expect(() => insert(chat(), null)).toThrow(/UNIQUE/);
  });
});
