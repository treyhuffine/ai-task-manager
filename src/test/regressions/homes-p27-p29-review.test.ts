/** Adversarial review of d0fff04. Failures assert the required behavior, not the defect. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getProvider } from '@agentex/agent';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { setUpAgentOn } from '@/test/fixtures/setups';
import type { FileCandidate, HistoryWindow } from '@/lib/import/history-source';
import { WORKER_PROTOCOL } from '@/lib/workers/protocol';

let home: TestHome;
let deviceId: string;
let keyId: string;
let agentId: string;
let chatId: string;
let executionId: string;
let token: string;
let homeId: string;
const startedPids: number[] = [];

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-p27-review-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  homeId = identity.ensureHomeIdentity().home.id;
  const q = await import('@/lib/db/queries');
  const grant = q.createDeviceGrant({ kind: 'enroll', deviceId: null, deviceName: 'Review laptop', createdByApiKeyId: null });
  const enrolled = q.redeemEnrollGrant({ secret: grant.secret, name: 'Review laptop' });
  deviceId = enrolled.device.id;
  keyId = enrolled.key.id;
  agentId = q.createWorkspace({ name: 'Review', cwd: home.root, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: true }).id;
  const created = q.createExecutionWithChat({ workspaceId: agentId, harness: 'claude', label: 'Review execution' });
  chatId = created.session.id;
  executionId = created.execution.id;
  q.createPlacement({ executionId, deviceId, startReason: 'created', worktreePath: home.root });
  token = (await import('@/lib/auth/session-token')).mintSessionToken({ chatSessionId: chatId, deviceId, generation: 1 })!;
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const pid of startedPids.splice(0)) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* Only a process this probe started. */ }
  }
  (await import('@/lib/executor/remote-live'))._resetRemoteLive();
  (await import('@/lib/workers/hub'))._resetWorkerHub();
  (await import('@/lib/worker/history'))._resetHistoryListing();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
});

const request = (url: string, bearer = token, method = 'POST') => new NextRequest(`http://127.0.0.1${url}`, {
  method, headers: { authorization: `Bearer ${bearer}` },
});

describe('P2.7 session authority', () => {
  // Adapted when the home's records became the only place an agent's folders
  // are kept (docs/homes-spec.md §4.1): the linked folder is where the home
  // records it on that device, and the flags and the manifest agree on it.
  it('wires the linked folder the home records for that device in the harness flags and the manifest alike', async () => {
    const q = await import('@/lib/db/queries');
    const newRef = path.join(home.root, 'new-reference');
    fs.mkdirSync(newRef);
    // Read only, so the deny rule names the wired path too, and the switch is
    // seen to reach the device the session runs on.
    q.createReferenceFolder({ workspaceId: agentId, alias: 'docs', path: path.join(home.root, 'on-the-home'), readOnly: true });
    await setUpAgentOn(agentId, deviceId, home.root, { links: { docs: newRef } });
    const { buildSessionSpec } = await import('@/lib/executor/session-spec');
    const spec = await buildSessionSpec({ chatSessionId: chatId, harness: 'claude', cwd: home.root,
      sessionType: 'execution', workspaceId: agentId, executionId, surfaceKind: null, surfaceRef: null,
      existingExternalSessionId: null, permissionMode: 'ask', prePlanMode: null, model: 'fake-model', modelVariant: null, effort: null,
    }, { deviceId, isHome: false, generation: 1 });
    // The spec carries what the home records, and wires no path. The runner
    // checks and wires them where the session starts.
    expect(spec.agentFolders?.references[0]?.path).toBe(newRef);
    expect(spec.extraArgs).not.toContain(newRef);
    // Nor the home's `ri` launcher: a session elsewhere keeps its device's.
    expect(spec.env.PATH).toBeUndefined();
    expect(spec.env.RI_SESSION_CLI).toBeUndefined();
    const fake = (await import('@/test/fixtures/fake-harness')).installFakeHarness('claude');
    const runner = await import('@/lib/runner/local-runner');
    // This probe inspects spawn configuration. Event persistence is covered
    // separately, so give the fake runner a sink rather than logging errors.
    (await import('@/lib/runner/sink')).installRunnerSink({ writer: { write: async () => true }, signal: () => {} });
    try {
      await runner.send({ chatSessionId: chatId, message: 'hello', turnId: 'review-turn', runId: null, spec });
      const config = fake.latest().ctx.config!;
      const { sessionEnvironmentPath } = await import('@/lib/executor/session-instructions');
      const env = JSON.parse(fs.readFileSync(sessionEnvironmentPath(chatId), 'utf8'));
      expect(env.references[0].path).toBe(newRef);
      expect.soft(config.extraArgs).toContain(newRef);
      expect.soft(config.disallowedTools).toContain(`Edit(/${newRef}/**)`);
      expect(fs.readFileSync(config.instructionsFile!, 'utf8')).not.toContain(path.join(home.root, 'on-the-home'));
    } finally {
      await runner.closeAllSessions();
      fake.restore();
      (await import('@/lib/executor/adapter'))._resetExecutorState();
    }
  });

  it("wires an agent main chat's linked folders elsewhere from the home's records for that device, not the home's own", async () => {
    const q = await import('@/lib/db/queries');
    const oldRef = path.join(home.root, 'on-the-home');
    const newRef = path.join(home.root, 'new-reference');
    fs.mkdirSync(oldRef);
    fs.mkdirSync(newRef);
    q.createReferenceFolder({ workspaceId: agentId, alias: 'docs', path: oldRef, readOnly: true });
    await setUpAgentOn(agentId, deviceId, home.root, { links: { docs: newRef } });
    const mainChat = q.createChatSession({ type: 'orchestration', workspaceId: agentId, harness: 'claude', status: 'active' });
    const { buildSessionSpec } = await import('@/lib/executor/session-spec');
    const spec = await buildSessionSpec({ chatSessionId: mainChat.id, harness: 'claude', cwd: home.root,
      sessionType: 'orchestration', workspaceId: agentId, surfaceKind: null, surfaceRef: null,
      existingExternalSessionId: null, permissionMode: 'ask', prePlanMode: null, model: 'fake-model', modelVariant: null, effort: null,
    }, { deviceId, isHome: false, generation: null });
    expect(spec.instructions ?? '').not.toContain(oldRef);
    expect(spec.extraArgs).not.toContain(oldRef);
    const fake = (await import('@/test/fixtures/fake-harness')).installFakeHarness('claude');
    const runner = await import('@/lib/runner/local-runner');
    (await import('@/lib/runner/sink')).installRunnerSink({ writer: { write: async () => true }, signal: () => {} });
    try {
      await runner.send({ chatSessionId: mainChat.id, message: 'hello', turnId: 'review-main-turn', runId: null, spec });
      const config = fake.latest().ctx.config!;
      expect(config.extraArgs).toContain(newRef);
      expect(config.disallowedTools).toContain(`Edit(/${newRef}/**)`);
      const instructions = fs.readFileSync(config.instructionsFile!, 'utf8');
      expect(instructions).toContain(newRef);
      expect(instructions).not.toContain(oldRef);
    } finally {
      await runner.closeAllSessions();
      fake.restore();
      (await import('@/lib/executor/adapter'))._resetExecutorState();
    }
  });

  it('rejects the token after its execution and chat are archived', async () => {
    const q = await import('@/lib/db/queries');
    const { proxy } = await import('@/proxy');
    expect(proxy(request(`/api/integrations/mcp?ws=${agentId}`)).status).toBe(200);
    q.archiveExecution(executionId);
    expect(q.getChatSession(chatId)?.status).toBe('archived');
    expect(proxy(request(`/api/integrations/mcp?ws=${agentId}`)).status).toBe(401);
  });

  it('does not revive a revoked enrollment token when that device enrolls again', async () => {
    const q = await import('@/lib/db/queries');
    const { proxy } = await import('@/proxy');
    (await import('@/lib/workers/retire')).retireWorker(keyId, deviceId, 'review revocation');
    expect(proxy(request(`/api/integrations/mcp?ws=${agentId}`)).status).toBe(401);
    const grant = q.createDeviceGrant({ kind: 'enroll', deviceId, deviceName: null, createdByApiKeyId: null });
    const fresh = (await import('@/lib/workers/enroll')).enrollWorker({ secret: grant.secret, name: 'Review laptop' });
    expect(fresh.key.id).not.toBe(keyId);
    expect(q.getWorkerDevice(keyId)).toBeNull();
    expect(proxy(request(`/api/integrations/mcp?ws=${agentId}`)).status).toBe(401);
  });

  it('keeps query parsing aligned, rejects route escapes, and rejects forged dotted tokens', async () => {
    const { proxy } = await import('@/proxy');
    for (const method of ['GET', 'POST', 'DELETE', 'PUT']) {
      for (const url of [
        '/api/tasks', '/api/workers/me', '/api/orchestrator/mcp',
        '/api/integrations/mcp?ws=other', `/api/integrations/mcp?ws=other&ws=${agentId}`,
        `/api/integrations/mcp?ws=${agentId}%26ws%3Dother`,
        `/api/integrations/mcp/?ws=${agentId}`, `/api/integrations/%6dcp?ws=${agentId}`,
        `/api/integrations/mcp/../run?ws=${agentId}`,
        `/api/orchestrator/browser/mcp?profile=default&profile=ws-${agentId}`,
      ]) expect(proxy(request(url, token, method)).status, `${method} ${url}`).toBe(403);
    }
    for (const url of [
      `/api/integrations/mcp?ws=${agentId}&ws=other`,
      `/api/integrations/mcp?%77s=${agentId}`,
      `/api/orchestrator/browser/mcp?profile=ws-${agentId}&profile=default`,
    ]) {
      expect(proxy(request(url)).status).toBe(200);
      // Both downstream routes use URL.searchParams.get, exactly as the proxy does.
      const parsed = new URL(`http://127.0.0.1${url}`).searchParams;
      expect(parsed.get('ws') ?? parsed.get('profile')).toMatch(new RegExp(agentId));
    }
    for (const bad of [token + '.extra', token.slice(0, -1), token + '=', token.replace(`.${deviceId}.`, '.forged.'), 'ri_session_...']) {
      expect(proxy(request(`/api/integrations/mcp?ws=${agentId}`, bad)).status).toBe(401);
    }
  });
});

describe('found in the live check', () => {
  it("doesn't reap a connected device's execution as a stuck setup when the home restarts", async () => {
    const q = await import('@/lib/db/queries');
    const { getDb } = await import('@/lib/db');
    const { executions } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');
    const longAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    // Placed on the laptop in beforeEach: its worktree is on the placement.
    getDb().update(executions).set({ setupStartedAt: longAgo, worktreePath: null }).where(eq(executions.id, executionId)).run();
    // And one of the home's own, genuinely stuck.
    const own = q.createExecutionWithChat({ workspaceId: agentId, harness: 'claude', label: 'stuck at home' }).execution;
    getDb().update(executions).set({ setupStartedAt: longAgo, worktreePath: null }).where(eq(executions.id, own.id)).run();
    expect(q.listStuckBootstrapExecutions().map((e) => e.id)).toEqual([own.id]);
  });

  it("retries a connected device's setup there, never by building a worktree on the home", async () => {
    const q = await import('@/lib/db/queries');
    const { retryProvisionWorktree, retrySetupScript } = await import('@/lib/sessions/dispatch');
    const ws = q.getWorkspace(agentId)!;
    const created = q.createExecutionWithChat({ workspaceId: agentId, harness: 'claude', label: 'not prepared yet' });
    const placement = q.createPlacement({ executionId: created.execution.id, deviceId, startReason: 'created' });
    const payload = { workspace: ws, chatSessionId: created.session.id, label: 'not prepared yet', baseBranch: null, prNumber: null, live: false };
    q.queueWorkerCommand({ deviceId, kind: 'prepare', payload, actor: { source: 'system' }, executionId: created.execution.id, chatSessionId: created.session.id, generation: placement.generation });
    q.recordExecutionSetupError(created.execution.id, 'The device could not prepare this execution.');

    await retryProvisionWorktree(created.session.id);
    const prepares = q.listWorkerCommands(deviceId).filter((c) => c.kind === 'prepare' && c.executionId === created.execution.id);
    expect(prepares).toHaveLength(2);
    expect(prepares[1]!.payload).toMatchObject({ chatSessionId: created.session.id, live: false });
    expect(q.getExecution(created.execution.id)).toMatchObject({ worktreePath: null, setupError: null });

    // Prepared there already (beforeEach's execution): a failure recorded
    // against it is cleared, with nothing sent.
    q.recordExecutionSetupError(executionId, 'Setup did not complete in time. Retry to start over.');
    const before = q.listWorkerCommands(deviceId).length;
    await retryProvisionWorktree(chatId);
    expect(q.getExecution(executionId)?.setupError).toBeNull();
    expect(q.listWorkerCommands(deviceId)).toHaveLength(before);

    // Its setup script is run there again, and there's none to run when it never had one.
    expect(retrySetupScript(executionId)).toBe(false);
    const script = { script: 'setup', workspaceId: agentId, command: 'pnpm install', worktreePath: home.root, branchName: 'ri/demo' };
    q.queueWorkerCommand({ deviceId, kind: 'run_script', payload: script, actor: { source: 'system' }, executionId, chatSessionId: chatId, generation: 1 });
    expect(retrySetupScript(executionId)).toBe(true);
    const scripts = q.listWorkerCommands(deviceId).filter((c) => c.kind === 'run_script');
    expect(scripts).toHaveLength(2);
    expect(scripts[1]!.payload).toEqual(script);
  });

  it("continues an archived laptop execution without building its worktree on the home (re-check)", async () => {
    const q = await import('@/lib/db/queries');
    const { getDb } = await import('@/lib/db');
    const { workspaces } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');
    getDb().update(workspaces).set({ isGit: true }).where(eq(workspaces.id, agentId)).run();
    q.archiveExecution(executionId);
    const { continueExecutionSession } = await import('@/lib/sessions/dispatch');
    const continued = await continueExecutionSession({ sessionId: chatId });
    expect(continued?.status).toBe('active');
    expect(q.getExecution(executionId)).toMatchObject({ status: 'active', worktreePath: null, setupStartedAt: null });
  });
});

describe('P2.8 retirement and process ownership', () => {
  it('does not restore live state from a heartbeat that finishes reading after revocation', async () => {
    const q = await import('@/lib/db/queries');
    const headers = new Headers({
      'x-ri-api-key-id': keyId,
      'x-ri-api-key-scope': 'worker', 'x-ri-worker-device-id': deviceId,
      'x-ri-worker-protocol': String(WORKER_PROTOCOL),
    });
    // The route's trusted headers are exactly those the real proxy supplies.
    const { POST } = await import('@/app/api/workers/me/heartbeat/route');
    let release!: (body: unknown) => void;
    const json = new Promise((resolve) => { release = resolve; });
    const pending = POST({ headers, json: () => json } as unknown as NextRequest);
    (await import('@/lib/workers/retire')).retireWorker(keyId, deviceId, 'review revocation');
    expect(q.getWorkerDevice(keyId)).toBeNull();
    release({ protocol: WORKER_PROTOCOL, version: 'review', harnesses: [], state: 'awake', live: {
      running: [chatId], pending: [], backgroundTasks: {}, generations: { [chatId]: 1 },
    } });
    const result = await pending;
    expect.soft(result.status).toBe(401);
    expect((await import('@/lib/executor/remote-live')).listRemoteRunning()).not.toContain(chatId);
  });

  it('does not kill an unrelated orphan merely for mentioning the instructions directory', async () => {
    const marker = path.join(home.workDir, 'session-instructions') + path.sep;
    // Model a detached user tool reading a saved instructions file. This is
    // our own harmless process, never a real user process or harness.
    const pid = Number(execFileSync(process.execPath, ['-e', `
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', '--', process.argv[1]], { detached: true, stdio: 'ignore' });
      console.log(child.pid); child.unref();
    `, marker + 'unrelated-reader.md']).toString().trim());
    startedPids.push(pid);
    // Fixed: a restarted worker stops only what its crashed predecessor
    // recorded starting (leftovers.ts). Here that predecessor is gone and
    // recorded no children, and the reader is an orphan naming its folder.
    const { processIdentity, stopLeftovers } = await import('@/lib/worker/leftovers');
    for (let i = 0; i < 100 && !(await processIdentity(pid)); i++) await new Promise((r) => setTimeout(r, 20));
    expect((await processIdentity(pid))?.command).toContain(marker);
    const record = path.join(home.workDir, 'worker-processes.json');
    fs.mkdirSync(home.workDir, { recursive: true });
    fs.writeFileSync(record, JSON.stringify({ worker: { pid: 999_999, ppid: 1, started: 'Mon Jan 1 00:00:00 2001', command: 'ri worker run' }, children: [] }));
    const stopped = await stopLeftovers(record, 500);
    expect(stopped).not.toContain(pid);
    expect(await processIdentity(pid)).not.toBeNull();
  });
});

const nativeId = '11111111-1111-4111-8111-111111111111';
function transcript(texts: string[]): string {
  return texts.map((text, i) => JSON.stringify({ type: 'user', uuid: `row-${i}`, sessionId: nativeId,
    cwd: home.root, timestamp: `2026-09-20T10:00:0${i}.000Z`, isSidechain: false,
    message: { role: 'user', content: text },
  })).join('\n') + '\n';
}

async function historyCandidate(): Promise<FileCandidate> {
  const claudeRoot = path.join(home.root, 'fake-claude-home');
  const file = path.join(claudeRoot, 'projects', 'project', `${nativeId}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, transcript(['old first', 'old second']));
  const history = getProvider('claude').localHistory!;
  const sessions = [];
  for await (const session of history.discover({ env: { CLAUDE_CONFIG_DIR: claudeRoot }, mainSessionsOnly: true, requireUserMessage: true })) sessions.push(session);
  expect(sessions).toHaveLength(1);
  // Discovery records the real folder the transcript was found in (fileCandidate).
  return { kind: 'file', history, historySession: sessions[0]!, realDir: fs.realpathSync(path.dirname(sessions[0]!.transcriptPath)), key: `claude:${Buffer.from(nativeId).toString('base64url')}`,
    source: 'claude', externalSessionId: nativeId, cwd: home.root, label: 'Review', startedAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:01.000Z', branchName: null, imported: false, importStatus: 'not_imported',
  };
}

describe('P2.9 selected transcript reads', () => {
  it('migrates a populated import ledger without changing rowids, FTS, or foreign keys', async () => {
    const Database = (await import('better-sqlite3')).default;
    const { createDatabaseAt, migrationTags } = await import('@/test/fixtures/migrations');
    const { runMigrations } = await import('@/lib/db/migrate');
    const file = path.join(home.root, 'pre-homes.db');
    createDatabaseAt(file, migrationTags()[1]!);
    const sqlite = new Database(file);
    try {
      sqlite.exec("INSERT INTO chat_sessions (id,type,status,permission_mode,harness) VALUES ('old-chat','execution','active','ask','claude')");
      sqlite.exec("INSERT INTO chat_events (id,session_id,role,source,content) VALUES ('old-event','old-chat','assistant','agent','keep me')");
      sqlite.exec("INSERT INTO external_session_imports (id,chat_session_id,provider_type,external_session_id,source_kind,sync_offset,status) VALUES ('old-ledger','old-chat','claude','same-id','file',0,'current')");
      const before = sqlite.prepare('SELECT rowid,* FROM external_session_imports').all();
      const events = sqlite.prepare('SELECT rowid,* FROM chat_events').all();
      const fts = sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE name LIKE '%fts%' ORDER BY name").all();
      // The homes migration and every one since.
      expect(runMigrations(sqlite, path.resolve('drizzle')).applied).toBe(migrationTags().length - 2);
      const rows = sqlite.prepare('SELECT rowid,* FROM external_session_imports').all() as Array<Record<string, unknown>>;
      expect(rows.map(({ device_id: device, ...row }) => { expect(device).toBeNull(); return row; })).toEqual(before);
      // The homes migration also adds `part_revision`, empty on old events.
      expect(sqlite.prepare('SELECT rowid,* FROM chat_events').all()).toEqual(events.map((e) => ({ ...(e as object), part_revision: null })));
      expect(sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE name LIKE '%fts%' ORDER BY name").all()).toEqual(fts);
      expect(sqlite.pragma('foreign_key_check')).toEqual([]);
      expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    } finally { sqlite.close(); }
  });

  it('does not certify old events with the hash of a replacement transcript at a window boundary', async () => {
    const candidate = await historyCandidate();
    const realRead = candidate.history.read.bind(candidate.history);
    const file = candidate.historySession.transcriptPath;
    let replacements = 0;
    const racing: FileCandidate = { ...candidate, history: { ...candidate.history, async *read(session, opts) {
      let count = 0;
      for await (const item of realRead(session, opts)) {
        yield item;
        if (++count === 1 && replacements++ === 0) {
          // Atomic replacement between yields, while the parser still holds
          // the old fd. The next yield closes the first size-limited window.
          fs.writeFileSync(file + '.new', transcript(['new first', 'new second']));
          fs.renameSync(file + '.new', file);
        }
      }
    } } };
    const source = await import('@/lib/import/history-source');
    // Fixed: the window read while the file was replaced is refused, and
    // read again from the replacement (history-source.ts, pinTranscript).
    const first = await source.readHistoryWindow(racing, { fromOffset: 0, expect: null, maxBytes: 1 });
    expect(replacements).toBe(2);
    expect(first.done).toBe(false);
    expect(first.events[0]?.content).toBe('new first');
    const { getDb } = await import('@/lib/db');
    const { externalSessionImports } = await import('@/lib/db/schema');
    const q = await import('@/lib/db/queries');
    const ledger = getDb().insert(externalSessionImports).values({ id: 'review-ledger', chatSessionId: chatId,
      providerType: 'claude', externalSessionId: nativeId, deviceId, sourceKind: 'file', syncOffset: 0, status: 'importing',
    }).returning().get();
    const { createHistoryWindowWriter } = await import('@/lib/import/external-agents');
    function commit(window: HistoryWindow) {
      const current = q.getExternalSessionImportForChat(chatId) ?? ledger;
      createHistoryWindowWriter(current, { replace: window.replaced, sourceUpdatedAt: candidate.updatedAt }).commit(
        window.events.map((input) => ({ input })), { syncOffset: window.nextOffset, sourceSize: window.nextOffset, sourceContentSha256: window.prefixSha256 },
      );
    }
    commit(first);
    const second = await source.readHistoryWindow(candidate, { fromOffset: first.nextOffset,
      expect: { size: first.nextOffset, sha256: first.prefixSha256 }, maxBytes: 1_000_000 });
    commit(second);
    const later = await source.readHistoryWindow(candidate, { fromOffset: second.nextOffset,
      expect: { size: second.nextOffset, sha256: second.prefixSha256 }, maxBytes: 1_000_000 });
    expect(later.events).toEqual([]);
    expect(later.replaced).toBe(false);
    expect(q.listChatEvents(chatId).map((e) => e.content)).toEqual(['new first', 'new second']);
  });

  it('refuses a window of a transcript that keeps changing, with nothing to commit', async () => {
    const candidate = await historyCandidate();
    const realRead = candidate.history.read.bind(candidate.history);
    const file = candidate.historySession.transcriptPath;
    let reads = 0;
    const churning: FileCandidate = { ...candidate, history: { ...candidate.history, async *read(session, opts) {
      reads++;
      for await (const item of realRead(session, opts)) {
        yield item;
        fs.appendFileSync(file, transcript([`appended ${reads}`]));
      }
    } } };
    const source = await import('@/lib/import/history-source');
    await expect(source.readHistoryWindow(churning, { fromOffset: 0, expect: null, maxBytes: 1 }))
      .rejects.toMatchObject({ code: 'source_changed_during_read' });
    expect(reads).toBe(3);
  });

  it('refuses a listed transcript whose folder was relinked elsewhere', async () => {
    const candidate = await historyCandidate();
    const source = await import('@/lib/import/history-source');
    vi.spyOn(source, 'discoverCandidatesInternal').mockResolvedValue({ candidates: [candidate],
      available: { claude: true, codex: false, opencode: false }, completed: { claude: true, codex: true, opencode: true },
    });
    const worker = await import('@/lib/worker/history');
    expect((await worker.listHistory()).sessions).toHaveLength(1);
    // The project folder is swapped for a link to one holding a different
    // file under the same name.
    const projectDir = path.dirname(candidate.historySession.transcriptPath);
    const elsewhere = path.join(home.root, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, path.basename(candidate.historySession.transcriptPath)), transcript(['private body never selected']));
    fs.rmSync(projectDir, { recursive: true });
    fs.symlinkSync(elsewhere, projectDir);
    await expect(worker.readHistory({ key: candidate.key, fromOffset: 0, expect: null, maxBytes: 65536 }))
      .rejects.toMatchObject({ code: 'not_a_transcript' });
  });

  it('rejects a cached selected transcript replaced by a symlink to an unselected file', async () => {
    const candidate = await historyCandidate();
    const source = await import('@/lib/import/history-source');
    vi.spyOn(source, 'discoverCandidatesInternal').mockResolvedValue({ candidates: [candidate],
      available: { claude: true, codex: false, opencode: false }, completed: { claude: true, codex: true, opencode: true },
    });
    const worker = await import('@/lib/worker/history');
    expect((await worker.listHistory()).sessions).toHaveLength(1);
    const privateFile = path.join(home.root, 'unselected-private.txt');
    fs.writeFileSync(privateFile, transcript(['private body never selected']));
    fs.unlinkSync(candidate.historySession.transcriptPath);
    fs.symlinkSync(privateFile, candidate.historySession.transcriptPath);
    await expect(worker.readHistory({ key: candidate.key, fromOffset: 0, expect: null, maxBytes: 65536 })).rejects.toThrow();
  });

  it('rejects traversal keys and another harness key rather than turning either into a path', async () => {
    const candidate = await historyCandidate();
    const source = await import('@/lib/import/history-source');
    vi.spyOn(source, 'discoverCandidatesInternal').mockResolvedValue({ candidates: [candidate],
      available: { claude: true, codex: false, opencode: false }, completed: { claude: true, codex: true, opencode: true },
    });
    const worker = await import('@/lib/worker/history');
    const listing = await worker.listHistory();
    expect(JSON.stringify(listing)).not.toContain('fake-claude-home');
    expect(JSON.stringify(listing)).not.toContain('old second');
    for (const key of [source.sessionKey('claude', '../../private.txt'), candidate.key.replace('claude:', 'codex:')]) {
      await expect(worker.readHistory({ key, fromOffset: 0, expect: null, maxBytes: 65536 })).rejects.toThrow('no longer on this device');
    }
  });
});
